#!/usr/bin/env bash
# Oracle Ubuntu images block every port except 22 with iptables, even when the
# VCN security list allows it. Open 80 (HTTP, needed for the certificate) and 443 (HTTPS).
set -euo pipefail
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save
echo "Ports 80 and 443 open (iptables saved)."
