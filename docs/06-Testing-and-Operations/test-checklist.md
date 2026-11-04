# Test Plan & Verification Checklist

## 1. Quality Assurance Test Matrix

Before deploying a machine to the field, the following comprehensive verification checklist must pass 100%:

| Test ID | Category | Test Description | Acceptance Criteria | Status |
|---|---|---|---|---|
| **T-01** | Power System | Measure voltage rails under maximum load (Pump + 2 Valves + LCD). | 12V rail $\ge 11.8\text{V}$, 5V rail $\ge 4.9\text{V}$, 3.3V rail within $\pm 0.05\text{V}$. | [ ] Pass |
| **T-02** | Load Cell | Apply known $100\text{g}$, $500\text{g}$, $1000\text{g}$ weights on platform. | Reading accuracy within $\pm 2\text{ grams}$. | [ ] Pass |
| **T-03** | Bottle Detection | Place empty $15\text{g}$ and $35\text{g}$ bottles on scale. | Scale reliably detects bottle presence ($> 20\text{g}$) and switches Red LED to Green. | [ ] Pass |
| **T-04** | Dispense 0.5L | Dispense target $500\text{ ml}$ into graduated cylinder. | Delivered volume between $495\text{ ml}$ and $505\text{ ml}$ ($\pm 1\%$). | [ ] Pass |
| **T-05** | Dispense 0.75L| Dispense target $750\text{ ml}$ into graduated cylinder. | Delivered volume between $742\text{ ml}$ and $758\text{ ml}$ ($\pm 1\%$). | [ ] Pass |
| **T-06** | Dispense 1.0L | Dispense target $1000\text{ ml}$ into graduated cylinder. | Delivered volume between $990\text{ ml}$ and $1010\text{ ml}$ ($\pm 1\%$). | [ ] Pass |
| **T-07** | Two-Stage Cutoff | Observe valve transition during dispensing. | Fast valve closes cleanly at exactly $90\%$ of target; slow valve tops off. | [ ] Pass |
| **T-08** | Anti-Spill Guard| Remove bottle mid-dispense (at ~50% fill). | Machine cuts pump and snaps valves shut in $< 100\text{ ms}$; no continuous spillage. | [ ] Pass |
| **T-09** | Dry-Run Guard | Drain water until Low Float switch opens ($< 5\text{L}$). | Dispense request rejected; TFT displays "Water Low"; alert sent to cloud. | [ ] Pass |
| **T-10** | Cellular Telemetry | Trigger completed dispense and inspect server DB. | Transaction record appears in PostgreSQL with accurate volume & timestamp within 5s. | [ ] Pass |
| **T-11** | QR Payment Flow | Complete simulated payment webhook. | Machine unlocks volume selection screen within 2 seconds of payment verification. | [ ] Pass |
| **T-12** | Hydrostatic Leak | Leave system pressurized under static pump head for 30 minutes. | 0 drops observed at all quick-connect fittings, valves, and flow sensor joints. | [ ] Pass |

