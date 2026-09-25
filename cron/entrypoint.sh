#!/bin/sh
set -e

if [ -z "$SYNC_SECRET" ]; then
  echo "SYNC_SECRET غير موجود — أوقف التشغيل"
  exit 1
fi

: "${SYNC_SCHEDULE:=*/30 * * * *}"

envsubst < /crontab.template > /etc/crontabs/root
echo "" >> /etc/crontabs/root   # crond يحتاج سطر فارغ في النهاية

echo "جدولة المزامنة: $SYNC_SCHEDULE"
crond -f -d 8
