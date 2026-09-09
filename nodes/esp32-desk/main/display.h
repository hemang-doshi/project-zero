#pragma once
#include "desk_protocol.h"
void display_init(void);
void display_status(const zero_view *view, bool online, int64_t elapsed);
void display_pairing(const char *fingerprint);

void display_levels(uint8_t level, uint8_t bass, int64_t now);
void display_animate(int64_t now, bool online);
