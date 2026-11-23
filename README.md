# SalonBook ? Server

Express REST API for salon services, customer appointments, admin management, and Stripe payments. It shares MongoDB with the Next.js Better Auth application.

## Links

- Client repository: https://github.com/devsumonali/salon_book_client
- Server repository: https://github.com/devsumonali/salon_book_server
- Live website / API: https://salon-book-client-alpha.vercel.app/

## Features and technology

Node.js, Express 5, MongoDB native driver, jose JWT verification, and Stripe. Public service browsing supports name search, multiple categories, and ascending/descending price sorting. Protected APIs support personal appointments and profile updates, admin service CRUD, confirmation/cancellation, customer blocking, overview counts, and read-only transactions.

JWT verification checks signature, expiry, issuer, audience, the active Better Auth session, and the current database user. Blocking a customer revokes their sessions. Public signup cannot assign admin access.

Only a verified Stripe webhook updates payment status and saves a transaction. The success page reads the saved appointment status; it never marks a payment as paid.

## Run locally

Use Node.js 22 or newer. Install dependencies and copy .env.example to .env. Supply these variable names locally:

    MONGODB_URI
    CLIENT_URL
    AUTH_URL
    PORT
    STRIPE_SECRET_KEY
    STRIPE_WEBHOOK_SECRET

Use the same MONGODB_URI as the client; the database name is salon_booking_db. CLIENT_URL is the Next.js origin used for CORS and checkout redirects. AUTH_URL is that same origin used to fetch /api/auth/jwks and verify the JWT issuer/audience. Locally use http://localhost:3000 for both and port 8000 for the API. Use Stripe test keys during development.

    npm install
    npm run dev

Production start command:

    npm start

Start the client as described in its README. Authentication and JWT signing are owned by Next.js; the backend needs access to its JWKS endpoint.

## Simple folder guide

    index.js                     Starts MongoDB and Express; uses PORT
    src/app.js                   CORS, raw signed Stripe webhook and JSON routes
    src/config/                  MongoDB collections and Stripe client
    src/middleware/verifyToken.js JWT, current session, role and blocked checks
    src/routes/services/         Public browse/detail and admin-only service writes
    src/routes/customer/         Overview, own appointments, cancellation, checkout
    src/routes/profile/          Own profile GET/PATCH for either role
    src/routes/admin/            Overview, all appointments, users, transactions
    src/routes/payments/         Read-only checkout details for the owner
    src/lib/                     Validation, appointment details and webhook persistence
    scripts/                     Explicit admin setup, sample services and checks
    tests/                       Unit and temporary-fixture integration tests

Each route has a comment describing its purpose. APIs use ordinary async functions and MongoDB collection methods.

## API map

| Method     | URL                                     | Purpose / access                                                |
| ---------- | --------------------------------------- | --------------------------------------------------------------- |
| GET        | /api/services                           | Public active services; search, category, sort query parameters |
| GET        | /api/services/:id                       | Authenticated service details; customers see active only        |
| POST       | /api/services                           | Admin create service                                            |
| PATCH      | /api/services/:id                       | Admin update service or active status                           |
| DELETE     | /api/services/:id                       | Admin delete service                                            |
| GET        | /api/customer/overview                  | Customer appointment counts and recent bookings                 |
| GET, POST  | /api/customer/appointments              | Customer's own list / request a slot                            |
| PATCH      | /api/customer/appointments/:id/cancel   | Owner cancels an unpaid pending request                         |
| POST       | /api/customer/appointments/:id/checkout | Owner pays a confirmed unpaid request                           |
| GET, PATCH | /api/customer/profile                   | Either role reads/updates their own name, image, phone          |
| GET        | /api/admin/overview                     | Admin counts and successful payment totals                      |
| GET        | /api/admin/services                     | Admin sees active and inactive services                         |
| GET        | /api/admin/appointments                 | Admin sees all requests and details                             |
| PATCH      | /api/admin/appointments/:id/confirm     | Admin confirms a pending request                                |
| PATCH      | /api/admin/appointments/:id/cancel      | Admin cancels pending/confirmed requests                        |
| GET        | /api/admin/users                        | Admin lists customer details                                    |
| PATCH      | /api/admin/users/:id                    | Admin sets a customer's isBlocked boolean                       |
| GET        | /api/admin/transactions                 | Admin reads verified paid/failed records                        |
| GET        | /api/checkout-session/:sessionId        | Owner reads Stripe checkout details                             |
| POST       | /api/webhooks/stripe                    | Signed Stripe events only                                       |

Protected calls require an Authorization: Bearer JWT header. The client obtains this JWT server-side from Better Auth; an opaque browser session token is not an API JWT.

Example browse queries: /api/services?search=hair, /api/services?category=hair-styling&category=skin-care, /api/services?sort=price-asc. Supported sort values are price-asc and price-desc. The frontend clears category when searching and clears search when changing category, while preserving sorting.

## Database and existing bookings

Main collections are user (managed by Better Auth), services, appointments, and transactions. Better Auth also owns its session, account, verification, and jwks data. Existing field names such as userId, date, time, and the service snapshot are retained to keep the current frontend simple.

Startup renames the old service-booking collection to appointments when appointments does not exist. It preserves existing documents and IDs. A unique partial index blocks new active bookings for the same service/date/time. Old conflicting active bookings are retained with slotProtected=false; route validation still checks those bookings before accepting a new request. Cancelling an appointment releases its slot without deleting history.

Service details and prices are snapshotted when booking, so later service edits/deletion do not erase appointment history. Appointment times use Asia/Dhaka. Transactions have a unique stripeSessionId to make webhook retries safe. Legacy paid bookings are preserved but are not automatically converted into verified transactions; a matching signed Stripe event can populate their transaction history.

## Admin access and sample services

Register a normal account first, then run this private command on the server:

    npm run make-admin -- your-email@example.com

Sign in again afterward. This command updates only the explicitly chosen existing account. There is no public role-changing API. Share evaluation credentials privately.

To add enough sample services to reach six active public services without replacing existing ones:

    npm run seed:services

## Stripe webhook setup

For local development, run the Stripe CLI forwarding command:

    stripe listen --forward-to localhost:8000/api/webhooks/stripe

Put the signing secret printed by that command into STRIPE_WEBHOOK_SECRET and restart the server. For a deployed API, register its HTTPS /api/webhooks/stripe endpoint in Stripe and configure that endpoint's own signing secret.

Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, and checkout.session.async_payment_failed. Checkout uses the payment methods configured in your Stripe Dashboard. An unpaid completed event is treated as processing; a signed success records Paid and a transaction. A signed asynchronous failure records a failed transaction and permits a retry. A delayed failure cannot overwrite an already paid record.

Test the full flow: customer request ? admin confirmation ? Pay Now ? Stripe test-card checkout ? signed webhook ? paid appointment and transaction. Cancelling a paid appointment preserves payment history and does not automatically refund it.

## Tests

    npm test

Pure validation tests run by default; network integration tests are skipped. To run the integration suite, start both applications with their local .env settings, then:

    npm run test:integration

The integration suite creates temporary accounts/services/appointments, privately assigns its temporary admin, verifies role isolation, duplicate slots, profile permissions and blocking, renders dashboards, creates/reuses/expires a real Stripe test-mode checkout, and sends simulated signed webhook success/failure events. Fixtures are removed afterward. It does not enter a card or perform an actual charge. Use a development database and Stripe test credentials. TEST_API_URL can override the default local API URL for this test command.

## Deployment

Set PORT through your hosting provider, use matching HTTPS client/auth origins and the shared MongoDB database, configure the Google callback on the client and the Stripe webhook on this API, and run npm start. Confirm public routes and private-route refreshes work on the deployed client. Add the real live URLs above and provide admin credentials privately before submitting. Never commit .env files or secret keys.
