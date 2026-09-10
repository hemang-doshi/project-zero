#include "zero_release.h"
#include "bootloader_random.h"
#include "desk_protocol.h"
#include "device_identity.h"
#include "display.h"
#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "lwip/ip4_addr.h"
#include "mdns.h"
#include "nvs_flash.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

static nvs_handle_t nvs;
static char key[512], csr[1024], fingerprint[65], cert[2048], ca[2048],
    endpoint[192];
static char rx[8193], serial_line[8193];
static size_t rx_used, serial_used;
static bool serial_overflow;
static QueueHandle_t messages, audio_messages;
static esp_websocket_client_handle_t ws;
static volatile bool connected, wifi_ready;
static bool welcomed;
static int64_t panel_test_until, debug_at;
static unsigned queue_overflows;
static uint64_t audio_sequence;
static unsigned audio_received, audio_accepted;
static int64_t audio_age;
static char session_id[129];
static zero_view view;
static uint32_t sequence;
static char boot_nonce[33];
static int64_t last_heartbeat, last_screen, view_elapsed, view_at;
/* Task 7 link evidence (telemetry only; no behavior change from these counters).
   Prior evidence: Task 0 flap baseline (desk stable-OFFLINE in-window, ~1 daemon
   read-deadline failure/min, 0 resets) and .runtime/link-final-acceptance.log
   (TLS transport-read error drops the socket while wifi=1; immediate re-hello
   races daemon session teardown). RSSI sampled at join, reason/downtime per
   outage, heartbeat ack/miss + drop counters exported in node.register. */
static int link_rssi;
static unsigned link_reason, socket_drops, wifi_drops;
static unsigned hb_sent, hb_acked;
static uint32_t hb_pending_seq;
static int64_t link_down_at, link_downtime_ms;
static const char *str(const cJSON *v, const char *k) {
  cJSON *p = cJSON_GetObjectItemCaseSensitive(v, k);
  return cJSON_IsString(p) ? p->valuestring : "";
}
static void put(const char *k, const char *v) {
  ESP_ERROR_CHECK(nvs_set_str(nvs, k, v));
}
static bool safe_id(const char *s) {
  if (!*s || strlen(s) > 128)
    return false;
  for (; *s; s++)
    if (!((*s >= 'a' && *s <= 'z') || (*s >= 'A' && *s <= 'Z') ||
          (*s >= '0' && *s <= '9') || *s == '-' || *s == '_' || *s == ':' ||
          *s == '.'))
      return false;
  return true;
}
static void link_snapshot(zero_link_evidence *e) {
  e->rssi_dbm = link_rssi;
  e->wifi_reason = link_reason;
  e->downtime_ms = link_downtime_ms;
  e->hb_sent = hb_sent;
  e->hb_acked = hb_acked;
  e->socket_drops = socket_drops;
  e->wifi_drops = wifi_drops;
}
static void send_message(const char *type, const char *body) {
  if (!connected)
    return;
  char out[2048], stamp[32];
  time_t now = time(NULL);
  struct tm tm;
  gmtime_r(&now, &tm);
  strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &tm);
  int n = snprintf(
      out, sizeof(out),
      "{\"zero\":\"0.1\",\"type\":\"%s\",\"id\":\"button:%s:%" PRIu32
      "\",\"time\":\"%s\",\"source\":\"node:desk-display-01\",\"target\":"
      "\"runtime\",\"classification\":\"PRIVATE\",\"body\":%s}",
      type, boot_nonce, ++sequence, stamp, body);
  if (n > 0 && n < (int)sizeof(out))
    esp_websocket_client_send_text(ws, out, n, pdMS_TO_TICKS(1000));
}
/* Task 7 rejoin pacing (the ONLY behavior change in this task).
   Evidence (.runtime/link-final-acceptance.log:46-52,
   .runtime/link-build6-acceptance.log:101-109): socket drops on transient TLS
   transport-read errors while wifi=1, and join flaps on transient WiFi reasons
   2/7; the old code re-helloed immediately (<1 s), racing daemon session
   teardown (reset/deadline interleave in Task 0 baseline). Gate the
   application rejoin (session.hello) on a reason-aware backoff with jitter;
   the transport reconnect itself is untouched. */
static int64_t hello_not_before;
static unsigned sock_streak, wifi_streak;
static void websocket_event(void *arg, esp_event_base_t base, int32_t id,
                            void *data) {
  (void)arg;
  (void)base;
  esp_websocket_event_data_t *e = data;
  if (id == WEBSOCKET_EVENT_CONNECTED) {
    puts("ZERO SOCKET CONNECTED");
    connected = true;
    rx_used = 0;
  } else if (id == WEBSOCKET_EVENT_DISCONNECTED) {
    puts("ZERO SOCKET DISCONNECTED");
    connected = false;
    rx_used = 0;
    socket_drops++;
    if (!link_down_at)
      link_down_at = esp_timer_get_time() / 1000;
    hello_not_before = esp_timer_get_time() / 1000 +
                       (int64_t)zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT,
                                                     sock_streak++,
                                                     (unsigned)esp_random());
  } else if (id == WEBSOCKET_EVENT_DATA) {
    if (e->op_code != 1 && e->op_code != 0)
      return;
    if (e->payload_len > 8192 || e->data_len < 0 ||
        rx_used + (size_t)e->data_len > 8192) {
      printf("ZERO FRAME BOUNDS len=%d used=%u chunk=%d\n",e->payload_len,(unsigned)rx_used,e->data_len);
      connected = false;
      rx_used = 0;
      return;
    }
    if (e->payload_offset == 0 && e->op_code == 1)
      rx_used = 0;
    memcpy(rx + rx_used, e->data_ptr, e->data_len);
    rx_used += e->data_len;
    if (e->payload_offset + e->data_len == e->payload_len && e->fin) {
      rx[rx_used] = 0;
      if(rx_used<1024 && strstr(rx,"\"type\":\"display.telemetry\"")) {
        char latest[1024]={0};memcpy(latest,rx,rx_used+1);xQueueOverwrite(audio_messages,latest);
      } else if (xQueueSend(messages, rx, 0) != pdTRUE) {
        queue_overflows++;
        puts("ZERO COMMAND QUEUE OVERFLOW");
        connected = false;
      }
      rx_used = 0;
    }
  }
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t id,
                       void *data) {
  (void)arg;
  if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    wifi_ready = true;
    wifi_streak = 0;
    int64_t now = esp_timer_get_time() / 1000;
    if (link_down_at)
      link_downtime_ms = now - link_down_at;
    link_down_at = 0;
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK)
      link_rssi = ap.rssi;
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    link_reason = ((wifi_event_sta_disconnected_t*)data)->reason;
    printf("ZERO WIFI LOST reason=%u\n", link_reason);
    wifi_ready = false;
    wifi_drops++;
    if (!link_down_at)
      link_down_at = esp_timer_get_time() / 1000;
  }
}
static void handle(const char *message) {
  cJSON *root = zero_json(message);
  if (!root)
    return;
  if (strcmp(str(root, "zero"), "0.1") ||
      strcmp(str(root, "source"), "runtime"))
    return;
  struct tm runtime_time = {0};
  const char *stamp = str(root, "time");
  const char *fraction = strptime(stamp, "%Y-%m-%dT%H:%M:%S", &runtime_time);
  if (fraction && !strcmp(str(root,"type"),"session.welcome")) {
    struct timeval tv = {.tv_sec = mktime(&runtime_time)};
    if (*fraction=='.') { int scale=100000; for(fraction++; *fraction>='0'&&*fraction<='9'&&scale;fraction++,scale/=10)tv.tv_usec+=(*fraction-'0')*scale; }
    if (tv.tv_sec > 1700000000)
      settimeofday(&tv, NULL);
  }
  const char *type = str(root, "type");
  cJSON *body = cJSON_GetObjectItemCaseSensitive(root, "body");
  if (!strcmp(type, "ack")) {
    /* Task 7 link evidence: count daemon acks for our messages so the next
       node.register can report ack/miss rates. Net-new branch; untouched. */
    const char *aid = str(body, "id");
    size_t noncelen = strlen(boot_nonce);
    if (!strncmp(aid, "button:", 7)) {
      const char *sep = strchr(aid + 7, ':');
      if (sep && (size_t)(sep - (aid + 7)) == noncelen &&
          !strncmp(aid + 7, boot_nonce, noncelen) && sep[1]) {
        unsigned long seq = strtoul(sep + 1, NULL, 10);
        if (hb_pending_seq && seq == hb_pending_seq) {
          hb_acked++;
          hb_pending_seq = 0;
        }
      }
    }
    return;
  }
  if (!strcmp(type, "session.welcome")) {
    const char *s = str(body, "session_id");
    if (!safe_id(s))
      return;
    strcpy(session_id, s);
    welcomed = true;
    sock_streak = 0;
    {
      int64_t now = esp_timer_get_time() / 1000;
      if (link_down_at)
        link_downtime_ms = now - link_down_at;
      link_down_at = 0;
    }
    audio_sequence=0;
    char reg[512], link[ZERO_LINK_JSON_MAX];
    zero_link_evidence ev;
    link_snapshot(&ev);
    if (zero_link_format(link, sizeof(link), &ev) < 0)
      strcpy(link, "null");
    snprintf(reg, sizeof(reg),
             "{\"render_schema\":\"0.2\",\"artwork\":\"rgb565-32\",\"audio\":"
             "\"levels-v2\",\"firmware\":\"" ZERO_VERSION "\",\"build\":\"" ZERO_BUILD
             "\",\"capabilities\":[\"display.render\",\"display.clear\"],\"link\":%s}",
             link);
    send_message("node.register", reg);
    printf("ZERO ONLINE heap=%lu\n", (unsigned long)esp_get_free_heap_size());
  } else if (!strcmp(type,"display.telemetry") && welcomed) {
    audio_received++;
    zero_levels levels;
    if(!zero_audio_object(body,&levels)||strcmp(levels.session_id,session_id))return;
    char receipt[256];snprintf(receipt,sizeof(receipt),"{\"session_id\":\"%s\",\"sequence\":%llu}",session_id,(unsigned long long)levels.sequence);
    send_message("display.telemetry.ack",receipt);
    if(!fraction)return;
    struct timeval current;gettimeofday(&current,NULL);
    int64_t sent=(int64_t)mktime(&runtime_time)*1000;
    if(*fraction=='.'){int scale=100;for(fraction++;*fraction>='0'&&*fraction<='9'&&scale;fraction++,scale/=10)sent+=(*fraction-'0')*scale;}
    int64_t age=(int64_t)current.tv_sec*1000+current.tv_usec/1000-sent;
    audio_age=age;
    if(age< -1000||age>500)return;
    if(levels.sequence>audio_sequence){
      audio_accepted++;
      audio_sequence=levels.sequence;
      display_levels(levels.level,levels.bass,esp_timer_get_time()/1000);
    }
  } else if (!strcmp(type, "capability.invoke") && welcomed) {
    const char *id = str(body, "id"), *cap = str(body, "capability");
    if (!safe_id(id))
      return;
    char invocation[129];
    strcpy(invocation, id);
    bool ok = false;
    if (!strcmp(cap, "display.clear")) {
      memset(&view, 0, sizeof(view));
      view.idle = true;
      ok = true;
    } else if (!strcmp(cap, "display.render")) {
      zero_view next;
      if (zero_view_object(cJSON_GetObjectItemCaseSensitive(body, "input"),
                           &next)) {
        view = next;
        ok = true;
      }
    }
    if (ok) {
      view_elapsed = view.elapsed_ms;
      int64_t now_ms = (int64_t)time(NULL) * 1000;
      if (view.running && view.since_ms > 0 && now_ms > view.since_ms)
        view_elapsed += now_ms - view.since_ms;
      view_at = esp_timer_get_time() / 1000;
      if(esp_timer_get_time()/1000>=panel_test_until)display_status(&view, true, view_elapsed);
    }
    char result[320];
    snprintf(result, sizeof(result),
             "{\"id\":\"%s\",\"status\":\"%s\",\"output\":{\"revision\":%lld}}",
             invocation, ok ? "SUCCEEDED" : "REJECTED",
             (long long)view.revision);
    send_message("capability.result", result);
  }
}
static void serial_command(const char *line) {
  if(!strcmp(line,"PANELGRAY")){panel_test_until=esp_timer_get_time()/1000+30000;display_gray_test();puts("ZERO PANEL GRAY 30 SECONDS");return;}
  if(!strcmp(line,"PANELTEST")){panel_test_until=esp_timer_get_time()/1000+15000;display_test();puts("ZERO PANEL WHITE 15 SECONDS");return;}
  if (!strcmp(line, "CSR")) {
    printf("ZERO FINGERPRINT %s\nZERO CSR BEGIN\n%sZERO CSR END\n", fingerprint,
           csr);
    return;
  }
  cJSON *root = zero_json(line);
  if (!root || strcmp(str(root, "op"), "provision"))
    return;
  const char *ssid = str(root, "ssid"), *password = str(root, "password"),
             *url = str(root, "endpoint"), *c = str(root, "certificate"),
             *a = str(root, "ca");
  cJSON *ts = cJSON_GetObjectItemCaseSensitive(root, "time");
  if (strlen(ssid) > 32 || strlen(password) > 64 ||
      strlen(url) >= sizeof(endpoint) || strncmp(url, "wss://", 6) ||
      strlen(c) >= sizeof(cert) || strlen(a) >= sizeof(ca) ||
      !strstr(c, "BEGIN CERTIFICATE") || !strstr(a, "BEGIN CERTIFICATE") ||
      !cJSON_IsNumber(ts) || ts->valuedouble < 1700000000) {
    puts("ZERO PROVISION REJECTED");
    return;
  }
  put("ssid", ssid);
  put("password", password);
  put("endpoint", url);
  put("certificate", c);
  put("ca", a);
  ESP_ERROR_CHECK(nvs_set_i64(nvs, "epoch", (int64_t)ts->valuedouble));
  ESP_ERROR_CHECK(nvs_commit(nvs));
  puts("ZERO PROVISIONED");
  fflush(stdout);
  vTaskDelay(pdMS_TO_TICKS(100));
  esp_restart();
}
void app_main(void) {
  setenv("TZ", "UTC0", 1);
  tzset();
  ESP_ERROR_CHECK(nvs_flash_init());
  ESP_ERROR_CHECK(nvs_open("zero", NVS_READWRITE, &nvs));
  display_init();
  bootloader_random_enable();
  device_identity(nvs, key, sizeof(key), csr, sizeof(csr), fingerprint);
  unsigned char nonce[16];
  esp_fill_random(nonce, sizeof(nonce));
  for (int i = 0; i < 16; i++)
    snprintf(boot_nonce + 2 * i, 3, "%02x", nonce[i]);
  bootloader_random_disable();
  display_pairing(fingerprint);
  printf("ZERO READY reset=%d fingerprint=%s\n", esp_reset_reason(),
         fingerprint);
  messages = xQueueCreate(2, 8193);
  audio_messages=xQueueCreate(1,1024);
  configASSERT(audio_messages);
  configASSERT(messages);
  gpio_config_t button = {.pin_bit_mask = 1ULL << 0,
                          .mode = GPIO_MODE_INPUT,
                          .pull_up_en = GPIO_PULLUP_ENABLE};
  ESP_ERROR_CHECK(gpio_config(&button));
  ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 4096, 0, 0, NULL, 0));
  uart_set_baudrate(UART_NUM_0, 115200);
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t wi = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&wi));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                             wifi_event, NULL));
  ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                             wifi_event, NULL));
  wifi_config_t conf = {0};
  size_t n = sizeof(conf.sta.ssid);
  esp_err_t provisioned = nvs_get_str(nvs, "ssid", (char *)conf.sta.ssid, &n);
  n = sizeof(conf.sta.password);
  nvs_get_str(nvs, "password", (char *)conf.sta.password, &n);
  n = sizeof(cert);
  nvs_get_str(nvs, "certificate", cert, &n);
  n = sizeof(ca);
  nvs_get_str(nvs, "ca", ca, &n);
  n = sizeof(endpoint);
  nvs_get_str(nvs, "endpoint", endpoint, &n);
  int64_t epoch = 0;
  nvs_get_i64(nvs, "epoch", &epoch);
  struct timeval tv = {.tv_sec = epoch};
  settimeofday(&tv, NULL);
  if (provisioned == ESP_OK && cert[0] && ca[0]) {
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &conf));
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_wifi_connect();
    ESP_ERROR_CHECK(mdns_init());
  }
  ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
  zero_button button_state = {0};
  bool was_connected = false;
  int64_t next_wifi = 0;
  static char message[8193];
  while (1) {
    int64_t now = esp_timer_get_time() / 1000;
    unsigned char ch;
    while (uart_read_bytes(UART_NUM_0, &ch, 1, 0) == 1) {
      if (ch == '\n') {
        if (!serial_overflow) {
          serial_line[serial_used] = 0;
          serial_command(serial_line);
        }
        serial_used = 0;
        serial_overflow = false;
      } else if (ch != '\r') {
        if (serial_used < 8192)
          serial_line[serial_used++] = ch;
        else
          serial_overflow = true;
      }
    }
    if (provisioned == ESP_OK && !wifi_ready && now >= next_wifi) {
      esp_wifi_connect();
      /* Task 7: reason-aware retry (was fixed 1000 + rand()%1000, which hammers
         the AP on credential/config failures). Evidence: join flaps on
         transient reasons 2/7, .runtime/link-build6-acceptance.log:75-84. */
      next_wifi = now + (int64_t)zero_rejoin_delay_ms(
                            zero_rejoin_classify(link_reason), wifi_streak++,
                            (unsigned)esp_random());
    }
    if (wifi_ready && !ws) {
      mdns_result_t *found = NULL;
      if (mdns_query_ptr("_zero", "_tcp", 1500, 4, &found) == ESP_OK) {
        for (mdns_result_t *p = found; p; p = p->next) {
          if (p->hostname && p->port) {
            snprintf(endpoint, sizeof(endpoint), "wss://%s.local:%u/zero",
                     p->hostname, p->port);
            break;
          }
        }
        mdns_query_results_free(found);
      }
      esp_websocket_client_config_t cfg = {.uri = endpoint,
                                           .cert_pem = ca,
                                           .client_cert = cert,
                                           .client_key = key,
                                           .cert_common_name = "zero.local",
                                           .reconnect_timeout_ms = 1000,
                                           .network_timeout_ms = 10000,
                                           .buffer_size = 2048,
                                           .task_stack = 8192};
      ws = esp_websocket_client_init(&cfg);
      configASSERT(ws);
      esp_websocket_register_events(ws, WEBSOCKET_EVENT_ANY, websocket_event,
                                    NULL);
      ESP_ERROR_CHECK(esp_websocket_client_start(ws));
    }
    if (connected && !was_connected && now >= hello_not_before) {
      welcomed = false;
      send_message("session.hello",
                   "{\"versions\":[\"0.1\"],\"max_frame\":8192}");
      was_connected = true;
    }
    if (!connected) {
      welcomed = false;
      was_connected = false;
    }
    if (xQueueReceive(messages, message, 0) == pdTRUE)
      handle(message);
    char audio_message[1024];
    if(xQueueReceive(audio_messages,audio_message,0)==pdTRUE)handle(audio_message);
    if (zero_button_update(&button_state, gpio_get_level(0) == 0, now) &&
        welcomed) {
      char body[256];
      snprintf(body, sizeof(body),
               "{\"type\":\"input.button\",\"session_id\":\"%s\"}", session_id);
      send_message("event.publish", body);
      puts("ZERO BUTTON");
    }
    if (welcomed && now - last_heartbeat >= 30000) {
      char body[128];
      snprintf(body, sizeof(body),
               "{\"heap\":%lu,\"minimum_heap\":%lu,\"reset_reason\":%d}",
               (unsigned long)esp_get_free_heap_size(),
               (unsigned long)esp_get_minimum_free_heap_size(),
               esp_reset_reason());
      send_message("node.heartbeat", body);
      /* Task 7 link evidence: heartbeat ack rate. send_message stamped the id
         with ++sequence, so record it as the pending heartbeat; the ack branch
         in handle() clears it on match. Exported in the next node.register. */
      hb_sent++;
      hb_pending_seq = sequence;
      printf("ZERO HEALTH %s audio_rx=%u audio_ok=%u audio_age=%lld media=%s\n", body,audio_received,audio_accepted,(long long)audio_age,view.media);
      last_heartbeat = now;
    }
    if (cert[0] && now>=panel_test_until && now - last_screen >= 1000) {
      display_status(&view, welcomed,
                     view_elapsed + (view.running ? now - view_at : 0));
      last_screen = now;
    }
    if(cert[0] && now>=panel_test_until)display_animate(now,welcomed);
    if(now-debug_at>=10000){printf("ZERO LINK wifi=%d socket=%d welcomed=%d queue_overflows=%u audio_rx=%u audio_ok=%u rssi=%d reason=%u downtime_ms=%lld hb=%u/%u sock_drop=%u wifi_drop=%u\n",wifi_ready,connected,welcomed,queue_overflows,audio_received,audio_accepted,link_rssi,link_reason,(long long)link_downtime_ms,hb_sent,hb_acked,socket_drops,wifi_drops);debug_at=now;}
    esp_task_wdt_reset();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
