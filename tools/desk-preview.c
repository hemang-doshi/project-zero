#include "display.h"
#include <stdio.h>
int main(void){char input[8193];size_t n=fread(input,1,8192,stdin);input[n]=0;zero_view view;if(!zero_parse_view(input,&view))return 2;display_status(&view,true,view.elapsed_ms);return 0;}
