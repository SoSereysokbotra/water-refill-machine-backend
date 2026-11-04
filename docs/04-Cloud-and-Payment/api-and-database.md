# Cloud API & Database Schema

## 1. REST API Endpoints

The backend is hosted as a lightweight Node.js (Fastify/Express) or Python (FastAPI) service communicating with the machines over HTTPS/MQTT:

### 1.1 `POST /api/payment/verify`
Checks whether a payment transaction has been confirmed by the payment gateway webhook.

**Request Payload**:
```json
{
  "machine_id": "WRM-001",
  "txn_id": "TXN_20261103_00129"
}
```

**Response (Success)**:
```json
{
  "status": "PAID",
  "amount": 2.00,
  "currency": "THB",
  "timestamp": "2026-11-03T08:15:22Z"
}
```

---

### 1.2 `POST /api/transaction`
Called by the ESP32-S3 over 4G LTE immediately after water dispensing completes.

**Request Payload**:
```json
{
  "machine_id": "WRM-001",
  "txn_id": "TXN_20261103_00129",
  "target_volume_ml": 1000,
  "dispensed_flow_ml": 998,
  "dispensed_weight_g": 996,
  "duration_seconds": 24.2,
  "dual_check_passed": true,
  "tank_level": "HIGH",
  "timestamp": "2026-11-03T08:16:05Z"
}
```

**Response**:
```json
{
  "acknowledged": true,
  "recorded_at": "2026-11-03T08:16:06Z"
}
```

---

### 1.3 `POST /api/machine/:id/alert`
Emergency endpoint invoked whenever a critical hardware failure occurs.

**Request Payload**:
```json
{
  "machine_id": "WRM-001",
  "alert_type": "LOW_WATER_CUTOFF",
  "severity": "CRITICAL",
  "message": "Reservoir water level dropped below 5L threshold. Dispenser locked.",
  "timestamp": "2026-11-03T09:30:00Z"
}
```

---

## 2. PostgreSQL Relational Database Schema

```sql
-- 1. Machines Registry
CREATE TABLE machines (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location_name VARCHAR(150),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    tank_capacity_liters INT DEFAULT 60,
    current_tank_level VARCHAR(10) DEFAULT 'HIGH', -- 'HIGH', 'MID', 'LOW'
    status VARCHAR(20) DEFAULT 'ONLINE',           -- 'ONLINE', 'OFFLINE', 'MAINTENANCE'
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Transactions Log
CREATE TABLE transactions (
    id VARCHAR(64) PRIMARY KEY,
    machine_id VARCHAR(32) REFERENCES machines(id),
    target_volume_ml INT NOT NULL,
    dispensed_flow_ml INT NOT NULL,
    dispensed_weight_g INT NOT NULL,
    amount NUMERIC(8, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'THB',
    payment_method VARCHAR(20) DEFAULT 'QR',
    dual_check_passed BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Machine Alerts & Maintenance
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(32) REFERENCES machines(id),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL'
    message TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

