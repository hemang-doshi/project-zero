#pragma once
#include "desk_protocol.h"
void display_init(void);
void display_status(const zero_view *view, bool online, int64_t elapsed);
void display_pairing(const char *fingerprint);
