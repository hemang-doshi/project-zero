#include "display.h"
#ifndef ZERO_DISPLAY_PREVIEW
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif
#include "zero_release.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>
static uint16_t pixels[128 * 160];
#ifndef ZERO_DISPLAY_PREVIEW
static spi_device_handle_t lcd;
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
#else
static void flush(void){printf("P6\n128 160\n255\n");for(int i=0;i<128*160;i++){uint16_t c=(pixels[i]>>8)|(pixels[i]<<8);unsigned char rgb[3]={(unsigned char)(((c>>11)&31)*255/31),(unsigned char)(((c>>5)&63)*255/63),(unsigned char)((c&31)*255/31)};fwrite(rgb,1,3,stdout);}}
#endif
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
    static const uint8_t colon[5]={0,0x36,0x36,0,0},dot[5]={0,0x60,0x60,0,0},dash[5]={8,8,8,8,8},slash[5]={0x20,0x10,8,4,2};
    const uint8_t *shape = c==':'?colon:c=='.'?dot:(c=='-'||c=='_')?dash:c=='/'?slash:idx < 0 ? fallback : glyphs[idx];
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
#ifndef ZERO_DISPLAY_PREVIEW
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
  vTaskDelay(pdMS_TO_TICKS(500));
  // Match Times Gate's Adafruit initR(BLACKTAB) timing/power sequence.
  static const uint8_t frame[]={1,0x2c,0x2d},partial[]={1,0x2c,0x2d,1,0x2c,0x2d};
  static const uint8_t inversion[]={7},power1[]={0xa2,2,0x84},power2[]={0xc5},power3[]={0x0a,0},power4[]={0x8a,0x2a},power5[]={0x8a,0xee},vcom[]={0x0e};
  static const uint8_t gamma_positive[]={2,0x1c,7,0x12,0x37,0x32,0x29,0x2d,0x29,0x25,0x2b,0x39,0,1,3,0x10};
  static const uint8_t gamma_negative[]={3,0x1d,7,6,0x2e,0x2c,0x29,0x2d,0x2e,0x2e,0x37,0x3f,0,0,2,0x10};
  cmd(0xb1,frame,sizeof(frame));cmd(0xb2,frame,sizeof(frame));cmd(0xb3,partial,sizeof(partial));
  cmd(0xb4,inversion,sizeof(inversion));cmd(0xc0,power1,sizeof(power1));cmd(0xc1,power2,sizeof(power2));
  cmd(0xc2,power3,sizeof(power3));cmd(0xc3,power4,sizeof(power4));cmd(0xc4,power5,sizeof(power5));cmd(0xc5,vcom,sizeof(vcom));
  cmd(0x20,NULL,0);cmd(0xe0,gamma_positive,sizeof(gamma_positive));cmd(0xe1,gamma_negative,sizeof(gamma_negative));
  uint8_t color = 5, rotation = 0xc0;
  cmd(0x3a, &color, 1);
  cmd(0x36, &rotation, 1);
  cmd(0x13, NULL, 0);
  cmd(0x29, NULL, 0);
  vTaskDelay(pdMS_TO_TICKS(100));
#endif
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
static void rect(int x,int y,int w,int h,uint16_t color){color=(color>>8)|(color<<8);for(int row=y;row<y+h&&row<160;row++)for(int col=x;col<x+w&&col<128;col++)if(row>=0&&col>=0)pixels[row*128+col]=color;}
static void segment(int x,int y,const char *s,size_t skip,size_t count,uint16_t color){char clean[65];size_t n=0;for(const unsigned char *p=(const unsigned char*)s;*p&&n<64;p++){if((*p&0xc0)==0x80)continue;clean[n++]=(*p>=32&&*p<=126)?*p:'?';}clean[n]=0;if(skip>=n)return;char shown[20];size_t take=n-skip<count?n-skip:count;if(take>19)take=19;memcpy(shown,clean+skip,take);shown[take]=0;if(skip+take<n&&skip>0&&take>=2){shown[take-1]='.';shown[take-2]='.';}text(x,y,shown,1,color);}
static int wave_y=101;
static bool media_playing;
static int64_t audio_at=-1000, animation_at;
static float amplitude, velocity;
static uint8_t audio_level, audio_bass, history[14];
void display_levels(uint8_t level,uint8_t bass,int64_t now){audio_level=level;audio_bass=bass;audio_at=now;}
void display_animate(int64_t now,bool online){
 if(now-animation_at<50)return;
 animation_at=now;
 float target=online&&media_playing&&now-audio_at<500?(audio_level*0.25f+audio_bass*0.75f)*4.0f/255.0f:0;
 velocity=(velocity+(target-amplitude)*0.34f)*0.72f;amplitude+=velocity;
 if(amplitude<0)amplitude=0;
 if(amplitude>4)amplitude=4;
 memmove(history,history+1,13);history[13]=(uint8_t)(amplitude+0.5f);
 rect(90,wave_y-4,28,9,0x10a4);
 for(int i=0;i<14;i++)rect(90+i*2,wave_y-history[i],1,history[i]*2+1,0x5f37);
#ifndef ZERO_DISPLAY_PREVIEW
 uint16_t patch[28*9];for(int y=0;y<9;y++)memcpy(patch+y*28,pixels+(wave_y-4+y)*128+90,56);
 uint8_t x[]={0,90,0,117},y[]={0,wave_y-4,0,wave_y+4};cmd(0x2a,x,4);cmd(0x2b,y,4);cmd(0x2c,NULL,0);bytes(1,patch,sizeof(patch));
#endif
}
void display_status(const zero_view *v, bool online, int64_t elapsed) {
 const uint16_t bg=0x0842,panel=0x10a4,muted=0x94b2,accent=0x5f37,amber=0xfdc8;
 rect(0,0,128,160,bg);
 segment(6,7,v->project[0]?v->project:"CHOOSE A PROJECT",0,19,0xffff);
 rect(6,20,116,1,0x2945);
 char b[48];snprintf(b,sizeof(b),"FOCUS %s",v->idle?"IDLE":v->running?"RUNNING":"PAUSED");line(27,b,v->running?accent:amber);
 long long seconds=elapsed/1000;
 if(seconds<6000){snprintf(b,sizeof(b),"%02lld:%02lld",seconds/60,seconds%60);text(6,40,b,3,0xffff);}else{snprintf(b,sizeof(b),"%lld:%02lld:%02lld",seconds/3600,(seconds/60)%60,seconds%60);text(6,42,b,2,0xffff);}
 rect(2,70,124,51,panel);text(6,74,"SPOTIFY",1,muted);segment(60,74,!strcmp(v->media,"playing")?"PLAYING":!strcmp(v->media,"paused")?"PAUSED":!strcmp(v->media,"stopped")?"STOPPED":!strcmp(v->media,"not_running")?"CLOSED":"NO DATA",0,10,accent);
 if(v->has_artwork){for(int row=0;row<32;row++)for(int col=0;col<32;col++){int pos=(row*32+col)*2;pixels[(85+row)*128+48+col]=((uint16_t)v->artwork[pos+1]<<8)|v->artwork[pos];}}
 else {rect(48,85,32,32,0x2127);text(61,97,"S",1,muted);}
 size_t title_chars=0;for(const unsigned char *p=(const unsigned char*)v->track;*p;p++)if((*p&0xc0)!=0x80)title_chars++;
 int artist_y=title_chars>7?109:97;
 segment(4,86,v->track[0]?v->track:"NO SONG",0,7,0xffff);if(title_chars>7)segment(4,97,v->track,7,7,0xffff);
 segment(4,artist_y,v->artist,0,7,muted);
 wave_y=101;media_playing=!strcmp(v->media,"playing");
 for(int i=0;i<14;i++)rect(90+i*2,wave_y-history[i],1,history[i]*2+1,accent);
 snprintf(b,sizeof(b),"GIT %.35s",v->git[0]?v->git:"UNAVAILABLE");segment(6,128,b,0,19,muted);
 snprintf(b,sizeof(b),"CODEX %.33s",v->agent[0]?v->agent:"UNAVAILABLE");segment(6,139,b,0,19,muted);
 rect(6,151,4,4,online?accent:0xf800);text(15,150,online?"ONLINE":"OFFLINE",1,online?accent:0xf800);text(86,150,ZERO_VERSION,1,muted);
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

void display_test(void){rect(0,0,128,160,0xffff);flush();}

void display_gray_test(void){rect(0,0,128,160,0x8410);flush();}
