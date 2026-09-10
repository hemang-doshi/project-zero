#include "desk_protocol.h"
#include <math.h>
#include <stdalign.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
static union {
  max_align_t align;
  unsigned char bytes[16384];
} arena;
static size_t used;
static void *allocate(size_t n) {
  size_t a = alignof(max_align_t);
  n = (n + a - 1) & ~(a - 1);
  if (n > sizeof(arena.bytes) - used)
    return NULL;
  void *p = arena.bytes + used;
  used += n;
  return p;
}
static void release(void *p) { (void)p; }
static bool unique_keys(const cJSON *node) {
 const cJSON *p;
 cJSON_ArrayForEach(p,node) {
  if(cJSON_IsObject(node)) {for(const cJSON *before=node->child;before!=p;before=before->next) {if(!strcmp(before->string,p->string))return false;}}
  if((cJSON_IsObject(p)||cJSON_IsArray(p))&&!unique_keys(p))return false;
 }
 return true;
}
cJSON *zero_json(const char *s) {
  if (!s || strlen(s) > 8192)
    return NULL;
  int depth = 0;
  bool quote = false, escape = false;
  for (const char *p = s; *p; p++) {
    if (quote) {
      if (escape)
        escape = false;
      else if (*p == '\\')
        escape = true;
      else if (*p == '"')
        quote = false;
    } else if (*p == '"')
      quote = true;
    else if (*p == '{' || *p == '[') {
      if (++depth > 8)
        return NULL;
    } else if (*p == '}' || *p == ']') {
      if (--depth < 0)
        return NULL;
    }
  }
  if (depth || quote)
    return NULL;
  used = 0;
  cJSON_Hooks hooks = {allocate, release};
  cJSON_InitHooks(&hooks);
  cJSON *parsed=cJSON_ParseWithOpts(s, NULL, true);
  return parsed && unique_keys(parsed) ? parsed : NULL;
}
static int b64(char c){if(c>='A'&&c<='Z')return c-'A';if(c>='a'&&c<='z')return c-'a'+26;if(c>='0'&&c<='9')return c-'0'+52;if(c=='+')return 62;if(c=='/')return 63;return -1;}
static bool artwork_decode(const char *s,uint8_t *out){if(strlen(s)!=2732||s[2731]!='=')return false;size_t pos=0;for(size_t i=0;i<2732;i+=4){int a=b64(s[i]),b=b64(s[i+1]),c=b64(s[i+2]),d=i==2728?0:b64(s[i+3]);if(a<0||b<0||c<0||d<0)return false;if(i==2728 && (c&3))return false;out[pos++]=(a<<2)|(b>>4);out[pos++]=(b<<4)|(c>>2);if(i!=2728)out[pos++]=(c<<6)|d;}return pos==2048;}
bool zero_view_object(const cJSON *o, zero_view *v) {
  if (!cJSON_IsObject(o))
    return false;
  zero_view next = {0};
  next.idle = true;
  const cJSON *p;
  cJSON_ArrayForEach(p, o) {
    if(!strcmp(p->string,"artwork_rgb565")){if(!cJSON_IsString(p))return false;if(p->valuestring[0]){if(!artwork_decode(p->valuestring,next.artwork))return false;next.has_artwork=true;}}
    else if (!strcmp(p->string, "project")) {
      if (!cJSON_IsString(p) || strlen(p->valuestring) > 64)
        return false;
      strcpy(next.project, p->valuestring);
    } else if (!strcmp(p->string, "git") || !strcmp(p->string, "agent") ||
               !strcmp(p->string, "track") || !strcmp(p->string, "artist") ||
               !strcmp(p->string, "media")) {
      if (!cJSON_IsString(p) || strlen(p->valuestring) > 64)
        return false;
      char *dest = !strcmp(p->string, "git")      ? next.git
                   : !strcmp(p->string, "agent")  ? next.agent
                   : !strcmp(p->string, "track")  ? next.track
                   : !strcmp(p->string, "artist") ? next.artist
                                                  : next.media;
      strcpy(dest, p->valuestring);
    } else if (!strcmp(p->string, "state")) {
      if (!cJSON_IsString(p))
        return false;
      next.idle = !strcmp(p->valuestring, "IDLE");
      if (!strcmp(p->valuestring, "RUNNING"))
        next.running = true;
      else if (strcmp(p->valuestring, "PAUSED") &&
               strcmp(p->valuestring, "IDLE"))
        return false;
    } else if (!strcmp(p->string, "elapsed_ms") ||
               !strcmp(p->string, "since_ms") ||
               !strcmp(p->string, "revision")) {
      if (!cJSON_IsNumber(p) || !isfinite(p->valuedouble) ||
          p->valuedouble < 0 || p->valuedouble > 9007199254740991.0 ||
          floor(p->valuedouble) != p->valuedouble)
        return false;
      if (!strcmp(p->string, "elapsed_ms"))
        next.elapsed_ms = (int64_t)p->valuedouble;
      else if (!strcmp(p->string, "since_ms"))
        next.since_ms = (int64_t)p->valuedouble;
      else
        next.revision = (int64_t)p->valuedouble;
    } else
      return false;
  }
  *v = next;
  return true;
}
bool zero_parse_view(const char *s, zero_view *v) {
  return zero_view_object(zero_json(s), v);
}
bool zero_button_update(zero_button *b, bool down, int64_t now) {
  if (down != b->raw) {
    b->raw = down;
    b->changed = now;
  }
  if (b->raw != b->stable && now - b->changed >= 50) {
    b->stable = b->raw;
    return b->stable;
  }
  return false;
}

bool zero_audio_object(const cJSON *o, zero_levels *levels) {
 if (!cJSON_IsObject(o) || cJSON_GetArraySize(o)!=4) return false;
 zero_levels next={0}; const cJSON *p;
 cJSON_ArrayForEach(p,o) {
  if(!strcmp(p->string,"session_id")) {if(!cJSON_IsString(p)||!p->valuestring[0]||strlen(p->valuestring)>128)return false;strcpy(next.session_id,p->valuestring);}
  else {
   if(!cJSON_IsNumber(p)||!isfinite(p->valuedouble)||p->valuedouble<0||floor(p->valuedouble)!=p->valuedouble)return false;
   if(!strcmp(p->string,"sequence")){if(p->valuedouble<1||p->valuedouble>9007199254740991.0)return false;next.sequence=(uint64_t)p->valuedouble;}
   else if(!strcmp(p->string,"level")){if(p->valuedouble>255)return false;next.level=p->valueint;}
   else if(!strcmp(p->string,"bass")){if(p->valuedouble>255)return false;next.bass=p->valueint;}
   else return false;
  }
 }
 if(!next.session_id[0]||!next.sequence)return false;
 *levels=next;return true;
}

int zero_link_format(char *out, size_t cap, const zero_link_evidence *e) {
  if (!out || !e || cap < ZERO_LINK_JSON_MAX)
    return -1;
  if (e->rssi_dbm < -100 || e->rssi_dbm > 0)
    return -1;
  if (e->wifi_reason > 255)
    return -1;
  if (e->downtime_ms < 0 || (double)e->downtime_ms > 9007199254740991.0)
    return -1;
  unsigned missed = e->hb_sent >= e->hb_acked ? e->hb_sent - e->hb_acked : 0;
  int n = snprintf(out, cap,
                   "{\"rssi\":%d,\"reason\":%u,\"downtime_ms\":%lld,"
                   "\"hb_sent\":%u,\"hb_acked\":%u,\"hb_missed\":%u,"
                   "\"socket_drops\":%u,\"wifi_drops\":%u}",
                   e->rssi_dbm, e->wifi_reason, (long long)e->downtime_ms,
                   e->hb_sent, e->hb_acked, missed, e->socket_drops,
                   e->wifi_drops);
  if (n < 0 || n >= (int)cap || n >= ZERO_LINK_JSON_MAX)
    return -1;
  return n;
}

zero_rejoin_cause zero_rejoin_classify(unsigned wifi_reason) {
  switch (wifi_reason) {
  case 15: /* 4WAY_HANDSHAKE_TIMEOUT */
  case 16: /* GROUP_KEY_UPDATE_TIMEOUT */
  case 17: /* IE_IN_4WAY_DIFFERS */
  case 18: /* GROUP_CIPHER_INVALID */
  case 19: /* PAIRWISE_CIPHER_INVALID */
  case 20: /* AKMP_INVALID */
  case 21: /* UNSUPP_RSN_IE_VERSION */
  case 22: /* INVALID_RSN_IE_CAP */
  case 23: /* 802_1X_AUTH_FAILED */
  case 24: /* CIPHER_SUITE_REJECTED */
  case 202: /* AUTH_FAIL */
  case 203: /* ASSOC_FAIL */
  case 204: /* HANDSHAKE_TIMEOUT */
  case 205: /* CONNECTION_FAIL */
    return ZERO_REJOIN_AUTH;
  default:
    return ZERO_REJOIN_TRANSIENT;
  }
}

unsigned zero_rejoin_delay_ms(zero_rejoin_cause cause, unsigned consecutive,
                              unsigned rand16) {
  if (consecutive > 16)
    consecutive = 16;
  if (cause == ZERO_REJOIN_AUTH) {
    unsigned backoff = ZERO_REJOIN_SLOW_BASE_MS << consecutive;
    if (consecutive >= 3 || backoff > ZERO_REJOIN_SLOW_CAP_MS)
      backoff = ZERO_REJOIN_SLOW_CAP_MS;
    return backoff + (rand16 % (ZERO_REJOIN_SLOW_JITTER_MS + 1));
  }
  {
    unsigned backoff = ZERO_REJOIN_FAST_BASE_MS << consecutive;
    if (consecutive >= 4 || backoff > ZERO_REJOIN_FAST_CAP_MS)
      backoff = ZERO_REJOIN_FAST_CAP_MS;
    return backoff + (rand16 % (ZERO_REJOIN_FAST_JITTER_MS + 1));
  }
}
