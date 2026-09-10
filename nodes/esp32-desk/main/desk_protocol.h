#pragma once
#include "cJSON.h"
#include <stdbool.h>
#include <stdint.h>
typedef struct {
  char project[65];
  bool running, idle, has_artwork;
  uint8_t artwork[2048];
  char git[65], agent[65], track[65], artist[65], media[65];
  int64_t elapsed_ms, since_ms, revision;
} zero_view;
typedef struct {
  bool raw, stable;
  int64_t changed;
} zero_button;
cJSON *zero_json(const char *text);
bool zero_view_object(const cJSON *object, zero_view *view);
bool zero_parse_view(const char *text, zero_view *view);
bool zero_button_update(zero_button *b, bool down, int64_t now_ms);

typedef struct { char session_id[129]; uint64_t sequence; uint8_t level, bass; } zero_levels;
bool zero_audio_object(const cJSON *object, zero_levels *levels);

/* Task 7 link evidence: per-(re)connect telemetry, serialized into the bounded
   node.register body the daemon already stores via Advertise. All fields
   are fixed-width integers; the formatted object is always < ZERO_LINK_JSON_MAX
   bytes and the formatter allocates nothing (caller buffer + snprintf only). */
typedef struct {
  int rssi_dbm;            /* RSSI at join, -100..0; 0 = unknown */
  unsigned wifi_reason;    /* last 802.11 disconnect reason, 0 = none yet */
  int64_t downtime_ms;     /* last outage duration, monotonic ms, >= 0 */
  unsigned hb_sent, hb_acked;   /* heartbeat ack accounting (missed = sent - acked) */
  unsigned socket_drops;   /* transport-error socket drops since boot */
  unsigned wifi_drops;     /* WiFi disconnect events since boot */
} zero_link_evidence;
#define ZERO_LINK_JSON_MAX 192
/* Returns bytes written (sans NUL), or -1 when inputs are out of range or the
   buffer is smaller than ZERO_LINK_JSON_MAX. */
int zero_link_format(char *out, size_t cap, const zero_link_evidence *e);

/* Task 7 rejoin policy: reason-aware reconnect backoff with jitter.
   Evidence (.runtime/link-final-acceptance.log:46-52,
   .runtime/link-build6-acceptance.log:101-109): the socket drops on TLS
   transport-read errors while WiFi stays associated, and join flaps on
   transient reasons 2/7; the old code re-helloed immediately (<1 s), racing
   daemon session teardown (reset/deadline interleave). Transient causes get a
   fast capped backoff; credential/config auth failures get a slow backoff so
   the node never hammers the AP. Pure arithmetic: no heap, no I/O. */
#define ZERO_REJOIN_FAST_BASE_MS 500
#define ZERO_REJOIN_FAST_CAP_MS 4000
#define ZERO_REJOIN_FAST_JITTER_MS 500
#define ZERO_REJOIN_SLOW_BASE_MS 10000
#define ZERO_REJOIN_SLOW_CAP_MS 60000
#define ZERO_REJOIN_SLOW_JITTER_MS 10000
typedef enum { ZERO_REJOIN_TRANSIENT = 0, ZERO_REJOIN_AUTH = 1 } zero_rejoin_cause;
/* Classify an 802.11 disconnect reason: only known credential/config auth
   failures are SLOW; everything else (incl. 0/none and unknown) is TRANSIENT. */
zero_rejoin_cause zero_rejoin_classify(unsigned wifi_reason);
/* Delay in ms before the next rejoin attempt. consecutive counts unbroken
   failures (0 = first retry); rand16 is any 16-bit entropy for jitter. */
unsigned zero_rejoin_delay_ms(zero_rejoin_cause cause, unsigned consecutive, unsigned rand16);
