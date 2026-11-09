# water-refill-machine-backend

Backend and documentation for the IoT Water Refill Machine: QR payment (ABA PayWay KHQR), cashless water dispensing with flow + weight verification.

| Folder | Contents |
|---|---|
| [backend-prototype/](backend-prototype/) | Prototype Node.js payment server (ABA PayWay KHQR). See [backend-prototype/README.md](backend-prototype/README.md) |
| [firmware/esp32-gateway/](firmware/esp32-gateway/) | ESP32 WROOM-32 gateway firmware (PlatformIO). See [firmware/esp32-gateway/README.md](firmware/esp32-gateway/README.md) |
| [docs/](docs/) | Project documentation (hardware, firmware, backend, testing, operations) |

**Hardware team (STM32):** start with [docs/04-Cloud-and-Payment/stm32-qr-payment-integration.md](docs/04-Cloud-and-Payment/stm32-qr-payment-integration.md).

## Quick start (Prototype)

```bash
cd backend-prototype
npm install
cp .env.example .env   # PAYWAY_MODE=mock works without ABA credentials
npm run dev            # open http://localhost:3000/dev
```
