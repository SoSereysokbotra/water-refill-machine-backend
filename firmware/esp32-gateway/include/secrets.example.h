// Copy this file to secrets.h and fill in your values.
// secrets.h is git-ignored - never commit real passwords.
#pragma once

// Wi-Fi (2.4 GHz only - ESP32 does not support 5 GHz)
#define WIFI_SSID      "your-wifi-name"
#define WIFI_PASSWORD  "your-wifi-password"

// EMQX Cloud broker
#define MQTT_HOST      "d41b5d19.ala.asia-southeast1.emqxsl.com"
#define MQTT_PORT      8883
#define MQTT_USERNAME  "wrm-esp32-001"
#define MQTT_PASSWORD  "your-mqtt-password"

// Unique ID of this machine (used in MQTT topics: wrm/<MACHINE_ID>/...)
#define MACHINE_ID     "WRM-001"
