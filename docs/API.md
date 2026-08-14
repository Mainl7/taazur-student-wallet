# API v1

| Method | Path | Authority | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | يرد access token قصير العمر |
| POST | `/transactions/debit` | `CANTEEN_OPERATOR` | يتطلب Bearer token و`Idempotency-Key` |
| GET | `/health` | public | health probe |

طلب الخصم:

```json
{ "cardToken": "CARD-random-unguessable-token", "amount": 8 }
```

توسعة المسارات المتفق عليها: `/schools`، `/students`، `/cards`، `/wallets/top-up`، `/reports`، `/audit-logs`. جميعها تحت `/api/v1` وتحتاج مخطط Zod، صلاحية، ونطاق مدرسة عند إضافتها.
