 #!/bin/bash

if [ $# -ne 1 ] || ! [ -d "$1" ]
then
  exit 1
fi

(cd $1; npm install; pm2 restart RelayService.js)
