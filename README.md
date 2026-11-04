# water-refill-machine-backend

Backend and documentation for the IoT Water Refill Machine: QR payment (ABA PayWay KHQR), cashless water dispensing with flow + weight verification.

| Folder | Contents |
|---|---|
| [backend/](backend/) | Node.js payment server (ABA PayWay KHQR). See [backend/README.md](backend/README.md) |
| [docs/](docs/) | Project documentation (hardware, firmware, backend, testing, operations) |

**Hardware team (STM32):** start with [docs/04-Cloud-and-Payment/stm32-qr-payment-integration.md](docs/04-Cloud-and-Payment/stm32-qr-payment-integration.md).

## Quick start

```bash
cd backend
npm install
cp .env.example .env   # PAYWAY_MODE=mock works without ABA credentials
npm run dev            # open http://localhost:3000/dev
```
