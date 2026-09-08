#include "desk_protocol.h"
#include <assert.h>
#include <string.h>
int main(void) {
  zero_view v = {0};
  assert(zero_parse_view("{\"project\":\"Project "
                         "Zero\",\"state\":\"RUNNING\",\"elapsed_ms\":12000,"
                         "\"since_ms\":1000,\"revision\":2}",
                         &v));
  assert(!strcmp(v.project, "Project Zero") && v.elapsed_ms == 12000 &&
         v.running);
  assert(!zero_parse_view("{\"project\":42}", &v));
  assert(!zero_parse_view("{\"elapsed_ms\":-1}", &v));
  assert(!zero_parse_view("{\"state\":\"HACKED\"}", &v));
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
