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
