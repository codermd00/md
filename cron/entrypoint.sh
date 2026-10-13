#!/bin/sh
set -e

if [ -z "$SYNC_SECRET" ]; then
  echo "SYNC_SECRET غير موجود — أوقف التشغيل"
  exit 1
fi

envsubst < /crontab.template > /etc/crontabs/root
echo "" >> /etc/crontabs/root   # crond يحتاج سطر فارغ في النهاية

echo "cron: every minute; interval from Settings"
crond -f -d 8
