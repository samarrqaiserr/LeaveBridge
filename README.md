# LeaveBridge - Time-Off Microservice

A production-quality backend microservice for managing employee time-off requests with HCM system synchronization.

## Overview

LeaveBridge provides a comprehensive solution for time-off management with:
- **Request Lifecycle**: Create, approve, cancel, and track time-off requests
- **Balance Management**: Real-time balance tracking with reservation system
- **HCM Integration**: Synchronization with external Human Capital Management systems
- **Audit Trail**: Complete audit logging for compliance and debugging
- **Concurrency Control**: Optimistic locking for high-concurrency scenarios
- **Failure Recovery**: Transactional outbox pattern for reliable HCM communication

## Tech Stack

- **Backend**: NestJS (TypeScript)
- **Database**: SQLite (development) / PostgreSQL (production)
- **ORM**: TypeORM
- **Testing**: Jest with ≥80% coverage
- **Validation**: class-validator & class-transformer
- **HTTP Client**: Axios for HCM communication

## Quick Start

### Prerequisites

- Node.js ≥ 18.0.0
- npm ≥ 8.0.0

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd leavebridge

# Install dependencies
npm install

# Install mock HCM dependencies
cd mock-hcm
npm install
cd ..
```

### Environment Configuration

Create a `.env` file in the root directory:

```env
# Database
DB_TYPE=sqlite
DB_DATABASE=:memory:

# HCM Configuration
HCM_BASE_URL=http://localhost:3001
HCM_REJECT_RATIO=0.1

# Application
PORT=3000
NODE_ENV=development
```

### Running the Application

```bash
# Start the main application
npm run start

# Start in development mode with hot reload
npm run start:dev

# Start the mock HCM server (for testing)
npm run mock-hcm
```

## API Documentation

### Time-Off Management

#### Create Request
```http
POST /time-off/requests
Content-Type: application/json

{
  "employeeId": "emp123",
  "locationId": "loc001",
  "leaveType": "ANNUAL",
  "startDate": "2024-01-01",
  "endDate": "2024-01-05",
  "reason": "Family vacation"
}
```

#### Get Request
```http
GET /time-off/requests/{requestId}
```

#### Approve Request
```http
PATCH /time-off/requests/{requestId}/approve
Content-Type: application/json

{
  "managerId": "mgr456"
}
```

#### Cancel Request
```http
PATCH /time-off/requests/{requestId}/cancel
Content-Type: application/json

{
  "actorId": "emp123"
}
```

### Balance Management

#### Get Employee Balances
```http
GET /balances/{employeeId}/{locationId}
```

### Synchronization

#### Batch Sync
```http
POST /sync/batch
Content-Type: application/json

{
  "balances": [
    {
      "employeeId": "emp123",
      "locationId": "loc001",
      "leaveType": "ANNUAL",
      "balance": 25
    }
  ]
}
```

#### Webhook
```http
POST /sync/webhook
Content-Type: application/json

{
  "employeeId": "emp123",
  "locationId": "loc001",
  "leaveType": "ANNUAL",
  "delta": 5,
  "reason": "Anniversary bonus"
}
```

#### Audit Trail
```http
GET /audit/{employeeId}
```

## Testing

### Running Tests

```bash
# Run all tests with coverage
npm run test:cov

# Run unit tests only
npm run test -- --testPathPattern=unit

# Run integration tests only
npm run test -- --testPathPattern=integration

# Run end-to-end tests only
npm run test -- --testPathPattern=e2e

# Run tests in watch mode
npm run test:watch
```

### Test Structure

- **Unit Tests** (`test/unit/`): Isolated service logic testing
- **Integration Tests** (`test/integration/`): Database integration testing
- **E2E Tests** (`test/e2e/`): Full HTTP stack testing with mock HCM

### Coverage

The project maintains ≥80% code coverage across:
- Functions
- Statements  
- Branches
- Lines

Coverage reports are generated in `coverage/lcov-report/index.html`.

## Mock HCM Server

For testing and development, a mock HCM server is included with configurable behavior:

### Starting Mock HCM

```bash
# From project root
npm run mock-hcm

# Or from mock-hcm directory
cd mock-hcm && npm start
```

### Mock HCM Endpoints

#### Balance Endpoint
```http
GET /hcm/balance/{employeeId}/{locationId}/{leaveType}
```

#### Time-Off Submission
```http
POST /hcm/time-off
```

#### Batch Processing
```http
POST /hcm/batch
```

### Control Endpoints (for testing)

#### Set Specific Balance
```http
POST /hcm/__control/set-balance
{
  "employeeId": "emp123",
  "locationId": "loc001", 
  "leaveType": "ANNUAL",
  "balance": 20
}
```

#### Force Next Rejection
```http
POST /hcm/__control/force-next-reject
```

#### Control Availability
```http
POST /hcm/__control/go-offline
POST /hcm/__control/go-online
```

## Architecture

### Domain Model

```
Balance (employeeId, locationId, leaveType)
├── availableBalance: number
├── reservedDays: number
└── version: number (optimistic locking)

TimeOffRequest
├── status: PENDING | APPROVED | CANCELLED | REJECTED
├── startDate/endDate: Date
└── requestedDays: number

AuditLog
├── eventType: BALANCE_UPDATED | REQUEST_CREATED | etc.
├── source: HCM_REALTIME | HCM_BATCH | HCM_WEBHOOK | READYON_REQUEST
└── beforeValue/afterValue: number

OutboxEvent
├── status: PENDING | PENDING_RETRY | COMPLETED | FAILED
├── retryCount: number
└── nextRetryAt: Date
```

### Key Patterns

#### Optimistic Locking
- Version column on Balance entity
- Automatic retry on version conflicts

#### Transactional Outbox
- Atomic balance changes + outbox events
- Background retry with exponential backoff

#### Reservation System
- Reserve days on request creation
- Release on approval/cancellation
- Prevents double-spending

#### Comprehensive Auditing
- All balance mutations logged
- Request lifecycle tracking
- Source system attribution

## Business Rules

### Request Creation
- Check local balance ≥ requested days
- Create request as PENDING
- Write reservation hold in balance
- Return immediately (no HCM call)

### Request Approval
- Call HCM real-time API
- If HCM accepts: APPROVED + decrement balance + release reservation
- If HCM rejects: REJECTED + release reservation
- If HCM unreachable: PENDING + outbox event + 202 response

### Defensive Validation
- Independent balance verification: availableBalance - reservedDays - requestedDays ≥ 0
- Never trust HCM responses without validation

### Batch Sync
- Upsert all balances from payload
- Preserve existing reservations
- Log warnings for potential HCM rollbacks
- Idempotent processing

### Webhook Processing
- Apply delta (positive or negative)
- Floor logic: availableBalance - reservedDays ≥ 0
- Log BALANCE_FLOOR_APPLIED when floor used

## Deployment

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Application port | 3000 |
| `NODE_ENV` | Environment | development |
| `DB_TYPE` | Database type | sqlite |
| `DB_DATABASE` | Database path | :memory: |
| `HCM_BASE_URL` | HCM server URL | http://localhost:3001 |
| `HCM_REJECT_RATIO` | Mock rejection rate | 0.1 |

### Production Considerations

- Use PostgreSQL instead of SQLite
- Configure connection pooling
- Set up monitoring and alerting
- Implement proper logging
- Configure health checks
- Set up backup and recovery

## Troubleshooting

### Common Issues

#### Database Connection Errors
- Check database configuration in `.env`
- Verify database server is running
- Check connection string format

#### HCM Communication Failures
- Verify HCM_BASE_URL is correct
- Check network connectivity
- Review HCM server logs
- Check authentication credentials

#### Test Failures
- Ensure mock HCM server is running for E2E tests
- Check all dependencies are installed
- Verify environment configuration
- Review test setup files

### Debug Mode

```bash
# Start with debugging
npm run start:debug

# Run tests with debugging
npm run test:debug
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass with ≥80% coverage
6. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For questions and support:
- Review the TRD.md for technical details
- Check test files for usage examples
- Review API documentation above
- Check troubleshooting section
