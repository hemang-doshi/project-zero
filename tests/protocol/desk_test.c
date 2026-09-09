#include "desk_protocol.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
int main(void) {
  zero_view v = {0};
 FILE *fixtures=fopen("proto/fixtures/display-v02.tsv","r");assert(fixtures);char line[4096];while(fgets(line,sizeof(line),fixtures)){assert(zero_parse_view(line+2,&v)==(line[0]=='1'));}fclose(fixtures);
  assert(zero_parse_view("{\"project\":\"Project "
                         "Zero\",\"state\":\"RUNNING\",\"elapsed_ms\":12000,"
                         "\"since_ms\":1000,\"revision\":2}",
                         &v));
  assert(!strcmp(v.project, "Project Zero") && v.elapsed_ms == 12000 &&
         v.running);
  assert(!zero_parse_view("{\"project\":42}", &v));
  assert(!zero_parse_view("{\"elapsed_ms\":-1}", &v));
  assert(!zero_parse_view("{\"state\":\"HACKED\"}", &v));
  assert(
      zero_parse_view("{\"project\":\"Zero\",\"state\":\"IDLE\",\"git\":"
                      "\"MAIN\",\"agent\":\"UNAVAILABLE\",\"track\":\"Song\","
                      "\"artist\":\"Artist\",\"media\":\"playing\"}",
                      &v));
  assert(!strcmp(v.track, "Song") && v.idle);
  assert(!zero_parse_view("{\"track\":42}", &v));
  char encoded[2733];memset(encoded,'A',2731);encoded[2731]='=';encoded[2732]=0;char image_input[2800];snprintf(image_input,sizeof(image_input),"{\"artwork_rgb565\":\"%s\"}",encoded);assert(zero_parse_view(image_input,&v));assert(v.has_artwork);assert(!zero_parse_view("{\"artwork_rgb565\":\"invalid\"}",&v));
  zero_levels levels;assert(zero_audio_object(zero_json("{\"session_id\":\"s\",\"sequence\":1,\"level\":20,\"bass\":80}"),&levels));assert(levels.bass==80);assert(!zero_audio_object(zero_json("{\"session_id\":\"s\",\"sequence\":1,\"level\":256,\"bass\":80}"),&levels));
  zero_button b = {0};
  assert(!zero_button_update(&b, 0, 0));
  assert(!zero_button_update(&b, 1, 10));
  assert(!zero_button_update(&b, 1, 35));
  assert(zero_button_update(&b, 1, 70));
  assert(!zero_button_update(&b, 1, 200));
  assert(!zero_button_update(&b, 0, 250));
  assert(!zero_button_update(&b, 0, 310));
  assert(!zero_button_update(&b, 1, 320));
  assert(zero_button_update(&b, 1, 380));
  return 0;
}
