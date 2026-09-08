#pragma once
#include "cJSON.h"
#include <stdbool.h>
#include <stdint.h>
typedef struct {
  char project[65];
  bool running;
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
