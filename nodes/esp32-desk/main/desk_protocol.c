#include "desk_protocol.h"
#include <math.h>
#include <stdalign.h>
#include <stddef.h>
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
  return cJSON_ParseWithOpts(s, NULL, true);
}
bool zero_view_object(const cJSON *o, zero_view *v) {
  if (!cJSON_IsObject(o))
    return false;
  zero_view next = {0};
  const cJSON *p;
  cJSON_ArrayForEach(p, o) {
    if (!strcmp(p->string, "project")) {
      if (!cJSON_IsString(p) || strlen(p->valuestring) > 64)
        return false;
      strcpy(next.project, p->valuestring);
    } else if (!strcmp(p->string, "state")) {
      if (!cJSON_IsString(p))
        return false;
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
