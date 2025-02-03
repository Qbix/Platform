#! /bin/bash

for i in 40 50 70 76 80 120 144 150 152 180 196 200 310 1000; do convert -resize "$i"x"$i" icon.png $i.png; done

convert -resize 1000x icon.png 1000x.png

for i in 36 48 72 96 144 168 192; do convert -resize "$i"x"$i" icon.png android-icon-"$i"x"$i".png; done
