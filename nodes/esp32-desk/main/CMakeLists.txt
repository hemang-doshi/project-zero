idf_component_register(SRCS "main.c" "display.c" "desk_protocol.c" "device_identity.c"
 INCLUDE_DIRS "." REQUIRES esp_wifi esp_event esp_netif nvs_flash driver mbedtls json esp_timer esp_system bootloader_support esp_websocket_client mdns)
