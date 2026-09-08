#include "display.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>
static spi_device_handle_t lcd;
static uint16_t pixels[128 * 160];
static void bytes(int dc, const void *p, size_t n) {
  gpio_set_level(16, dc);
  spi_transaction_t t = {.length = n * 8, .tx_buffer = p};
  ESP_ERROR_CHECK(spi_device_polling_transmit(lcd, &t));
}
static void cmd(uint8_t c, const uint8_t *b, size_t n) {
  bytes(0, &c, 1);
  if (n)
    bytes(1, b, n);
}
static void flush(void) {
  uint8_t x[] = {0, 0, 0, 127}, y[] = {0, 0, 0, 159};
  cmd(0x2a, x, 4);
  cmd(0x2b, y, 4);
  cmd(0x2c, NULL, 0);
  bytes(1, pixels, sizeof(pixels));
}
// Five-column glyphs for the compact uppercase status surface.
static const uint8_t glyphs[36][5] = {{0x3e, 0x51, 0x49, 0x45, 0x3e},
                                      {0, 0x42, 0x7f, 0x40, 0},
                                      {0x42, 0x61, 0x51, 0x49, 0x46},
                                      {0x21, 0x41, 0x45, 0x4b, 0x31},
                                      {0x18, 0x14, 0x12, 0x7f, 0x10},
                                      {0x27, 0x45, 0x45, 0x45, 0x39},
                                      {0x3c, 0x4a, 0x49, 0x49, 0x30},
                                      {1, 0x71, 9, 5, 3},
                                      {0x36, 0x49, 0x49, 0x49, 0x36},
                                      {6, 0x49, 0x49, 0x29, 0x1e},
                                      {0x7e, 0x11, 0x11, 0x11, 0x7e},
                                      {0x7f, 0x49, 0x49, 0x49, 0x36},
                                      {0x3e, 0x41, 0x41, 0x41, 0x22},
                                      {0x7f, 0x41, 0x41, 0x22, 0x1c},
                                      {0x7f, 0x49, 0x49, 0x49, 0x41},
                                      {0x7f, 9, 9, 9, 1},
                                      {0x3e, 0x41, 0x49, 0x49, 0x7a},
                                      {0x7f, 8, 8, 8, 0x7f},
                                      {0, 0x41, 0x7f, 0x41, 0},
                                      {0x20, 0x40, 0x41, 0x3f, 1},
                                      {0x7f, 8, 0x14, 0x22, 0x41},
                                      {0x7f, 0x40, 0x40, 0x40, 0x40},
                                      {0x7f, 2, 0xc, 2, 0x7f},
                                      {0x7f, 4, 8, 0x10, 0x7f},
                                      {0x3e, 0x41, 0x41, 0x41, 0x3e},
                                      {0x7f, 9, 9, 9, 6},
                                      {0x3e, 0x41, 0x51, 0x21, 0x5e},
                                      {0x7f, 9, 0x19, 0x29, 0x46},
                                      {0x46, 0x49, 0x49, 0x49, 0x31},
                                      {1, 1, 0x7f, 1, 1},
                                      {0x3f, 0x40, 0x40, 0x40, 0x3f},
                                      {0x1f, 0x20, 0x40, 0x20, 0x1f},
                                      {0x3f, 0x40, 0x38, 0x40, 0x3f},
                                      {0x63, 0x14, 8, 0x14, 0x63},
                                      {7, 8, 0x70, 8, 7},
                                      {0x61, 0x51, 0x49, 0x45, 0x43}};
static void text(int x, int y, const char *s, int scale, uint16_t color) {
  color = (color >> 8) | (color << 8);
  for (; *s; s++, x += 6 * scale) {
    int c = toupper((unsigned char)*s), idx = c >= '0' && c <= '9' ? c - '0'
                                              : c >= 'A' && c <= 'Z'
                                                  ? c - 'A' + 10
                                                  : -1;
    if (x + 5 * scale > 128) {
      x = 8;
      y += 9 * scale;
    }
    if (c == ' ') continue;
    static const uint8_t fallback[5] = {0x02,0x01,0x51,0x09,0x06};
    const uint8_t *shape = idx < 0 ? fallback : glyphs[idx];
    for (int a = 0; a < 5; a++)
      for (int b = 0; b < 7; b++)
        if (shape[a] & (1 << b))
          for (int dx = 0; dx < scale; dx++)
            for (int dy = 0; dy < scale; dy++) {
              int px = x + a * scale + dx, py = y + b * scale + dy;
              if (px >= 0 && px < 128 && py >= 0 && py < 160)
                pixels[py * 128 + px] = color;
            }
  }
}
void display_init(void) {
  gpio_set_direction(16, GPIO_MODE_OUTPUT);
  gpio_set_direction(17, GPIO_MODE_OUTPUT);
  gpio_set_level(17, 0);
  vTaskDelay(pdMS_TO_TICKS(30));
  gpio_set_level(17, 1);
  vTaskDelay(pdMS_TO_TICKS(120));
  spi_bus_config_t bus = {.mosi_io_num = 23,
                          .miso_io_num = -1,
                          .sclk_io_num = 18,
                          .quadwp_io_num = -1,
                          .quadhd_io_num = -1,
                          .max_transfer_sz = sizeof(pixels)};
  ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));
  spi_device_interface_config_t dev = {
      .clock_speed_hz = 8000000, .mode = 0, .spics_io_num = 5, .queue_size = 1};
  ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &dev, &lcd));
  cmd(0x01, NULL, 0);
  vTaskDelay(pdMS_TO_TICKS(150));
  cmd(0x11, NULL, 0);
  vTaskDelay(pdMS_TO_TICKS(150));
  uint8_t color = 5, rotation = 0xc0;
  cmd(0x3a, &color, 1);
  cmd(0x36, &rotation, 1);
  cmd(0x13, NULL, 0);
  cmd(0x29, NULL, 0);
  vTaskDelay(pdMS_TO_TICKS(100));
}
static void line(int y, const char *s, uint16_t color) {
  char visible[20];
  size_t n = 0;
  for (const unsigned char *p = (const unsigned char *)s; *p && n < 19; p++) {
    if ((*p & 0xc0) == 0x80)
      continue;
    visible[n++] = (*p >= 32 && *p <= 126) ? (char)*p : '?';
  }
  visible[n] = 0;
  text(6, y, visible, 1, color);
}
void display_status(const zero_view *v, bool online, int64_t elapsed) {
  memset(pixels, 0, sizeof(pixels));
  line(6, "PROJECT ZERO", 0x07ff);
  line(22, v->project[0] ? v->project : "NO FOCUS", 0xffff);
  line(38,
       v->idle      ? "IDLE"
       : v->running ? "RUNNING"
                    : "PAUSED",
       v->running ? 0x07e0 : 0xffe0);
  char b[32];
  snprintf(b, sizeof(b), "%lld MIN %02lld SEC", (long long)(elapsed / 60000),
           (long long)((elapsed / 1000) % 60));
  line(53, b, 0xffff);
  line(72, v->git[0] ? v->git : "GIT UNAVAILABLE", 0x07ff);
  line(86, "AGENT UNAVAILABLE", 0x8410);
  line(104, v->track[0] ? v->track : "SPOTIFY UNAVAILABLE", 0xffff);
  line(117, v->artist, 0x8410);
  line(130, v->media, 0x07e0);
  line(148, online ? "CONNECTED" : "OFFLINE", online ? 0x07e0 : 0xf800);
  flush();
}
void display_pairing(const char *fp) {
  memset(pixels, 0, sizeof(pixels));
  text(8, 10, "PAIR ZERO", 2, 0x07ff);
  text(8, 48, "KEY FINGERPRINT", 1, 0xffff);
  text(8, 65, fp, 1, 0xffff);
  text(8, 140, "USB SETUP", 1, 0xffe0);
  flush();
}
