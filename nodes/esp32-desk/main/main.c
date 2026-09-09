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
static QueueHandle_t messages;
static esp_websocket_client_handle_t ws;
static volatile bool connected, wifi_ready;
static bool welcomed;
static char session_id[129];
static zero_view view;
static uint32_t sequence;
static char boot_nonce[33];
static int64_t last_heartbeat, last_screen, view_elapsed, view_at;
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
static void websocket_event(void *arg, esp_event_base_t base, int32_t id,
                            void *data) {
  (void)arg;
  (void)base;
  esp_websocket_event_data_t *e = data;
  if (id == WEBSOCKET_EVENT_CONNECTED) {
    connected = true;
    rx_used = 0;
  } else if (id == WEBSOCKET_EVENT_DISCONNECTED) {
    connected = false;
    rx_used = 0;
  } else if (id == WEBSOCKET_EVENT_DATA) {
    if (e->op_code != 1 && e->op_code != 0)
      return;
    if (e->payload_len > 8192 || e->data_len < 0 ||
        rx_used + (size_t)e->data_len > 8192) {
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
      if (xQueueSend(messages, rx, 0) != pdTRUE)
        connected = false;
      rx_used = 0;
    }
  }
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t id,
                       void *data) {
  (void)arg;
  (void)data;
  if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
    wifi_ready = true;
  else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED)
    wifi_ready = false;
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
  if (strptime(stamp, "%Y-%m-%dT%H:%M:%S", &runtime_time)) {
    struct timeval tv = {.tv_sec = mktime(&runtime_time)};
    if (tv.tv_sec > 1700000000)
      settimeofday(&tv, NULL);
  }
  const char *type = str(root, "type");
  cJSON *body = cJSON_GetObjectItemCaseSensitive(root, "body");
  if (!strcmp(type, "session.welcome")) {
    const char *s = str(body, "session_id");
    if (!safe_id(s))
      return;
    strcpy(session_id, s);
    welcomed = true;
    send_message("node.register", "{\"render_schema\":\"0.2\",\"firmware\":"
                                  "\"" ZERO_VERSION "\",\"build\":\"" ZERO_BUILD "\",\"capabilities\":["
                                  "\"display.render\",\"display.clear\"]}");
    printf("ZERO ONLINE heap=%lu\n", (unsigned long)esp_get_free_heap_size());
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
      display_status(&view, true, view_elapsed);
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
  messages = xQueueCreate(1, 8193);
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
      next_wifi = now + 1000 + (esp_random() % 1000);
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
                                           .network_timeout_ms = 3000,
                                           .buffer_size = 2048,
                                           .task_stack = 8192};
      ws = esp_websocket_client_init(&cfg);
      configASSERT(ws);
      esp_websocket_register_events(ws, WEBSOCKET_EVENT_ANY, websocket_event,
                                    NULL);
      ESP_ERROR_CHECK(esp_websocket_client_start(ws));
    }
    if (connected && !was_connected) {
      welcomed = false;
      send_message("session.hello",
                   "{\"versions\":[\"0.1\"],\"max_frame\":8192}");
    }
    if (!connected)
      welcomed = false;
    was_connected = connected;
    if (xQueueReceive(messages, message, 0) == pdTRUE)
      handle(message);
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
      printf("ZERO HEALTH %s\n", body);
      last_heartbeat = now;
    }
    if (cert[0] && now - last_screen >= 1000) {
      display_status(&view, welcomed,
                     view_elapsed + (view.running ? now - view_at : 0));
      last_screen = now;
    }
    esp_task_wdt_reset();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
