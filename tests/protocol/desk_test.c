#include "desk_protocol.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
int main(void) {
  zero_view v = {0};
 FILE *fixtures=fopen("proto/fixtures/display-v02.tsv","r");assert(fixtures);char line[4096];while(fgets(line,sizeof(line),fixtures)){assert(zero_parse_view(line+2,&v)==(line[0]=='1'));}fclose(fixtures);
  assert(zero_parse_view("{\"project\":\"Project "
                         "Zero\",\"state\":\"RUNNING\",\"elapsed_ms\":12000,"
                         "\"since_ms\":1000,\"revision\":2}",
                         &v));
  assert(!strcmp(v.project, "Project Zero") && v.elapsed_ms == 12000 &&
         v.running);
  assert(!zero_parse_view("{\"project\":42}", &v));
  assert(!zero_parse_view("{\"elapsed_ms\":-1}", &v));
  assert(!zero_parse_view("{\"state\":\"HACKED\"}", &v));
  assert(
      zero_parse_view("{\"project\":\"Zero\",\"state\":\"IDLE\",\"git\":"
                      "\"MAIN\",\"agent\":\"UNAVAILABLE\",\"track\":\"Song\","
                      "\"artist\":\"Artist\",\"media\":\"playing\"}",
                      &v));
  assert(!strcmp(v.track, "Song") && v.idle);
  assert(!zero_parse_view("{\"track\":42}", &v));
  char encoded[2733];memset(encoded,'A',2731);encoded[2731]='=';encoded[2732]=0;char image_input[2800];snprintf(image_input,sizeof(image_input),"{\"artwork_rgb565\":\"%s\"}",encoded);assert(zero_parse_view(image_input,&v));assert(v.has_artwork);assert(!zero_parse_view("{\"artwork_rgb565\":\"invalid\"}",&v));
  zero_levels levels;assert(zero_audio_object(zero_json("{\"session_id\":\"s\",\"sequence\":1,\"level\":20,\"bass\":80}"),&levels));assert(levels.bass==80);assert(!zero_audio_object(zero_json("{\"session_id\":\"s\",\"sequence\":1,\"level\":256,\"bass\":80}"),&levels));
  zero_button b = {0};
  assert(!zero_button_update(&b, 0, 0));
  assert(!zero_button_update(&b, 1, 10));
  assert(!zero_button_update(&b, 1, 35));
  assert(zero_button_update(&b, 1, 70));
  assert(!zero_button_update(&b, 1, 200));
  assert(!zero_button_update(&b, 0, 250));
  assert(!zero_button_update(&b, 0, 310));
  assert(!zero_button_update(&b, 1, 320));
  assert(zero_button_update(&b, 1, 380));
  /* Task 7 link evidence: bounded serialization + zero-growth proxy. */
  {
    zero_link_evidence e = {.rssi_dbm = -62, .wifi_reason = 2, .downtime_ms = 1340,
                            .hb_sent = 10, .hb_acked = 9, .socket_drops = 1, .wifi_drops = 2};
    char link[ZERO_LINK_JSON_MAX], tiny[16];
    assert(zero_link_format(NULL, sizeof(link), &e) == -1);
    assert(zero_link_format(link, sizeof(link), NULL) == -1);
    assert(zero_link_format(tiny, sizeof(tiny), &e) == -1);
    int n = zero_link_format(link, sizeof(link), &e);
    assert(n > 0 && n < ZERO_LINK_JSON_MAX);
    /* Exact schema round-trips through a real JSON parser. */
    cJSON *parsed = cJSON_Parse(link);
    assert(parsed);
    const cJSON *rssi = cJSON_GetObjectItemCaseSensitive(parsed, "rssi");
    const cJSON *reason = cJSON_GetObjectItemCaseSensitive(parsed, "reason");
    const cJSON *down = cJSON_GetObjectItemCaseSensitive(parsed, "downtime_ms");
    const cJSON *sent = cJSON_GetObjectItemCaseSensitive(parsed, "hb_sent");
    const cJSON *acked = cJSON_GetObjectItemCaseSensitive(parsed, "hb_acked");
    const cJSON *missed = cJSON_GetObjectItemCaseSensitive(parsed, "hb_missed");
    const cJSON *sdrops = cJSON_GetObjectItemCaseSensitive(parsed, "socket_drops");
    const cJSON *wdrops = cJSON_GetObjectItemCaseSensitive(parsed, "wifi_drops");
    assert(cJSON_IsNumber(rssi) && rssi->valueint == -62);
    assert(cJSON_IsNumber(reason) && reason->valueint == 2);
    assert(cJSON_IsNumber(down) && (int64_t)down->valuedouble == 1340);
    assert(cJSON_IsNumber(sent) && sent->valueint == 10);
    assert(cJSON_IsNumber(acked) && acked->valueint == 9);
    assert(cJSON_IsNumber(missed) && missed->valueint == 1);
    assert(cJSON_IsNumber(sdrops) && sdrops->valueint == 1);
    assert(cJSON_IsNumber(wdrops) && wdrops->valueint == 2);
    assert(cJSON_GetArraySize(parsed) == 8);
    cJSON_Delete(parsed);
    /* Deterministic: same input always yields byte-identical output (no hidden
       growth; the firmware path allocates nothing — caller buffer only). */
    char again[ZERO_LINK_JSON_MAX];
    for (int i = 0; i < 200; i++) {
      assert(zero_link_format(again, sizeof(again), &e) == n);
      assert(!strcmp(link, again));
    }
    /* Out-of-range inputs are rejected, never truncated into lies. */
    zero_link_evidence bad = e;
    bad.rssi_dbm = 5; assert(zero_link_format(link, sizeof(link), &bad) == -1);
    bad = e; bad.rssi_dbm = -101; assert(zero_link_format(link, sizeof(link), &bad) == -1);
    bad = e; bad.wifi_reason = 256; assert(zero_link_format(link, sizeof(link), &bad) == -1);
    bad = e; bad.downtime_ms = -1; assert(zero_link_format(link, sizeof(link), &bad) == -1);
    /* Worst-case field widths still fit the bound. */
    zero_link_evidence max = {.rssi_dbm = -100, .wifi_reason = 255,
                              .downtime_ms = 9007199254740991LL, .hb_sent = 4294967295u,
                              .hb_acked = 0, .socket_drops = 4294967295u, .wifi_drops = 4294967295u};
    int m = zero_link_format(link, sizeof(link), &max);
    assert(m > 0 && m < ZERO_LINK_JSON_MAX);
  }
  /* Task 7 rejoin policy: reason-aware backoff with jitter, pinned bounds. */
  {
    assert(zero_rejoin_classify(0) == ZERO_REJOIN_TRANSIENT);
    assert(zero_rejoin_classify(2) == ZERO_REJOIN_TRANSIENT);
    assert(zero_rejoin_classify(7) == ZERO_REJOIN_TRANSIENT);
    assert(zero_rejoin_classify(200) == ZERO_REJOIN_TRANSIENT);
    assert(zero_rejoin_classify(201) == ZERO_REJOIN_TRANSIENT);
    assert(zero_rejoin_classify(206) == ZERO_REJOIN_TRANSIENT);
    assert(zero_rejoin_classify(15) == ZERO_REJOIN_AUTH);
    assert(zero_rejoin_classify(23) == ZERO_REJOIN_AUTH);
    assert(zero_rejoin_classify(202) == ZERO_REJOIN_AUTH);
    assert(zero_rejoin_classify(204) == ZERO_REJOIN_AUTH);
    unsigned fast0 = zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT, 0, 0);
    assert(fast0 == ZERO_REJOIN_FAST_BASE_MS);
    unsigned fast0j = zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT, 0, 499);
    assert(fast0j >= ZERO_REJOIN_FAST_BASE_MS &&
           fast0j < ZERO_REJOIN_FAST_BASE_MS + ZERO_REJOIN_FAST_JITTER_MS + 1);
    for (unsigned r = 0; r < 600; r++) {
      unsigned d = zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT, 0, r);
      assert(d >= 500 && d <= 1000);
    }
    unsigned prev = 0;
    for (unsigned c = 0; c < 8; c++) {
      unsigned d = zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT, c, 0);
      assert(d >= prev);
      prev = d;
    }
    for (unsigned r = 0; r < 600; r++) {
      unsigned d = zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT, 99, r);
      assert(d >= ZERO_REJOIN_FAST_CAP_MS &&
             d <= ZERO_REJOIN_FAST_CAP_MS + ZERO_REJOIN_FAST_JITTER_MS);
    }
    unsigned slow0 = zero_rejoin_delay_ms(ZERO_REJOIN_AUTH, 0, 0);
    assert(slow0 == ZERO_REJOIN_SLOW_BASE_MS);
    for (unsigned r = 0; r < 600; r++) {
      unsigned d = zero_rejoin_delay_ms(ZERO_REJOIN_AUTH, 0, r);
      assert(d >= 10000 && d <= 20000);
    }
    for (unsigned r = 0; r < 600; r++) {
      unsigned d = zero_rejoin_delay_ms(ZERO_REJOIN_AUTH, 99, r);
      assert(d >= ZERO_REJOIN_SLOW_CAP_MS &&
             d <= ZERO_REJOIN_SLOW_CAP_MS + ZERO_REJOIN_SLOW_JITTER_MS);
    }
    /* Fast path always rejoins sooner than the slow path at equal streak. */
    for (unsigned c = 0; c < 6; c++)
      assert(zero_rejoin_delay_ms(ZERO_REJOIN_TRANSIENT, c, 1234) <
             zero_rejoin_delay_ms(ZERO_REJOIN_AUTH, c, 1234));
  }
  /* Task 38 transport-recovery invariant: a locally-detected dead socket
     (command-queue overflow, frame-bounds violation) MUST reset the real
     transport — never a silent connected=false while the socket lives on
     (that self-imposes a permanent offline: no DISCONNECTED event, no
     library auto-reconnect, no re-hello). */
  {
    zero_link_state s = {0};
    /* Remote DISCONNECTED: paces the hello, never requests a reset. */
    zero_link_note_drop(&s, 100000, 0, false);
    assert(!s.reset_requested);
    assert(s.streak == 1);
    assert(s.down_at_ms == 100000);
    assert(s.not_before_ms == 100000 + ZERO_REJOIN_FAST_BASE_MS);
    /* Local failure (overflow/frame-bounds): MUST request a transport reset,
       keep pacing the hello, and preserve the outage start. */
    zero_link_note_drop(&s, 100500, 0, true);
    assert(s.reset_requested);
    assert(s.streak == 2);
    assert(s.down_at_ms == 100000);
    assert(s.not_before_ms == 100500 + 2 * ZERO_REJOIN_FAST_BASE_MS);
    /* Jitter stays bounded on a fresh streak. */
    for (unsigned r = 0; r < 600; r++) {
      zero_link_state t = {0};
      zero_link_note_drop(&t, 0, r, true);
      assert(t.reset_requested);
      assert(t.not_before_ms >= ZERO_REJOIN_FAST_BASE_MS &&
             t.not_before_ms <=
                 ZERO_REJOIN_FAST_BASE_MS + ZERO_REJOIN_FAST_JITTER_MS);
    }
    /* A long mixed streak still requests the reset and stays capped. */
    for (unsigned r = 0; r < 600; r++) {
      zero_link_state t = {0};
      for (unsigned c = 0; c < 20; c++)
        zero_link_note_drop(&t, (int64_t)(c * 1000), r, (c % 2) == 0);
      assert(t.reset_requested);
      assert(t.streak == 20);
      assert(t.not_before_ms >= 19000 + ZERO_REJOIN_FAST_CAP_MS &&
             t.not_before_ms <=
                 19000 + ZERO_REJOIN_FAST_CAP_MS + ZERO_REJOIN_FAST_JITTER_MS);
    }
    /* Null-safe: the event callback must never crash. */
    zero_link_note_drop(NULL, 0, 0, true);
  }
  return 0;
}
