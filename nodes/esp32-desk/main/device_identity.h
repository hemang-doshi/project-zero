#pragma once
#include "nvs.h"
void device_identity(nvs_handle_t nvs, char *key, size_t key_size, char *csr,
                     size_t csr_size, char fingerprint[65]);
