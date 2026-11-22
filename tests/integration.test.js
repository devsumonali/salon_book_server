import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import Stripe from 'stripe';
import {
    db,
    userCollection,
    serviceCollection,
    serviceBookingcollection,
    transactionCollection,
} from '../src/config/database.js';

// Uses only temporary test accounts/services. Real customer records are never edited.
// Start both apps, then run npm run test:integration.
test(
    'JWT, roles, bookings, administration and signed payment webhooks',
    { skip: process.env.RUN_INTEGRATION !== '1', timeout: 180000 },
    async () => {
        const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
        const apiUrl = process.env.TEST_API_URL || 'http://localhost:8000';
        const run = randomBytes(6).toString('hex');
        const password = randomBytes(18).toString('base64url') + 'Aa1';
        const userIds = [];
        let serviceId;
        let checkoutId;
        assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Integration checks require a Stripe test-mode secret key');
        assert.ok(process.env.STRIPE_WEBHOOK_SECRET, 'Configure a development webhook signing secret');
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

        async function account(kind) {
            const email = 'salonbook-test-' + run + '-' + kind + '@example.invalid';
            const response = await fetch(clientUrl + '/api/auth/sign-up/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: clientUrl },
                body: JSON.stringify({
                    name: 'Test ' + kind,
                    email,
                    password,
                    role: 'admin',
                    isBlocked: true,
                }),
            });
            const data = await response.json();
            assert.equal(response.status, 200, data.message || 'Test signup failed');
            const id = data.user.id;
            userIds.push(id);
            const cookie = response.headers
                .getSetCookie()
                .map((value) => value.split(';')[0])
                .join('; ');
            const tokenResponse = await fetch(clientUrl + '/api/auth/token', {
                headers: { Cookie: cookie },
            });
            const tokenData = await tokenResponse.json();
            assert.equal(tokenResponse.status, 200, 'JWT could not be issued');
            assert.equal(tokenData.token.split('.').length, 3);
            return { id, email, cookie, token: tokenData.token };
        }

        async function call(route, token, method = 'GET', body) {
            const response = await fetch(apiUrl + route, {
                method,
                headers: {
                    ...(token ? { Authorization: 'Bearer ' + token } : {}),
                    'Content-Type': 'application/json',
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                data = { message: text.slice(0, 100) };
            }
            return { status: response.status, data };
        }

        try {
            const weak = await fetch(clientUrl + '/api/auth/sign-up/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: clientUrl },
                body: JSON.stringify({
                    name: 'Weak test',
                    email: 'salonbook-test-' + run + '-weak@example.invalid',
                    password: 'lowercase',
                }),
            });
            const weakData = await weak.json();
            if (weakData.user?.id) userIds.push(weakData.user.id);
            assert.equal(weak.status, 400, 'Weak passwords must be rejected by the server');
            const customer = await account('customer');
            assert.equal(
                (await userCollection.findOne({ _id: new ObjectId(customer.id) })).isBlocked,
                false,
            );
            const other = await account('other');
            const admin = await account('admin');
            // Role is assigned privately, never by the public registration request.
            assert.equal(
                (await userCollection.findOne({ _id: new ObjectId(admin.id) })).role,
                'user',
            );
            await userCollection.updateOne(
                { _id: new ObjectId(admin.id) },
                { $set: { role: 'admin' } },
            );
            assert.equal((await call('/api/admin/overview')).status, 401);
            assert.equal((await call('/api/admin/overview', customer.token)).status, 403);
            assert.equal((await call('/api/admin/overview', admin.token)).status, 200);
            const parts = customer.token.split('.');
            parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
            assert.equal((await call('/api/customer/overview', parts.join('.'))).status, 401);
            console.log(
                'PASS: signed JWTs, tampered JWT rejection, and fresh database role verification',
            );

            const service = {
                name: 'Test service ' + run,
                category: 'hair-styling',
                description: 'Temporary automated test service.',
                price: 5,
                duration: 30,
                image: 'https://example.com/test.jpg',
                status: 'active',
            };
            assert.equal(
                (await call('/api/services', customer.token, 'POST', service)).status,
                403,
            );
            assert.equal(
                (await call('/api/services', admin.token, 'POST', { ...service, price: 0 })).status,
                400,
            );
            const created = await call('/api/services', admin.token, 'POST', service);
            assert.equal(created.status, 201);
            serviceId = created.data.insertedId;
            assert.equal((await call('/api/services/' + serviceId, customer.token)).status, 200);
            assert.equal((await call('/api/services/not-valid', customer.token)).status, 404);
            assert.equal(
                (
                    await call('/api/services/' + serviceId, admin.token, 'PATCH', {
                        status: 'inactive',
                    })
                ).status,
                200,
            );
            assert.equal((await call('/api/services/' + serviceId, customer.token)).status, 404);
            await call('/api/services/' + serviceId, admin.token, 'PATCH', { status: 'active' });
            console.log(
                'PASS: admin-only service writes, positive-number validation and inactive-service protection',
            );

            const booking = {
                serviceId,
                date: '2035-11-22',
                time: '11:00 AM',
                notes: 'Temporary test',
                userId: other.id,
                service: { price: 0.01 },
            };
            assert.equal(
                (await call('/api/customer/appointments', admin.token, 'POST', booking)).status,
                403,
            );
            assert.equal(
                (await call('/api/customer/appointments', customer.token, 'POST', booking)).status,
                201,
            );
            const stored = await serviceBookingcollection.findOne({
                serviceId,
                userId: customer.id,
            });
            assert.equal(stored.service.price, 5);
            assert.equal(stored.paymentStatus, 'unpaid');
            assert.equal(
                (await call('/api/customer/appointments', other.token, 'POST', booking)).status,
                409,
            );
            assert.equal(
                (
                    await call(
                        '/api/customer/appointments/' + stored._id + '/checkout',
                        customer.token,
                        'POST',
                    )
                ).status,
                409,
            );
            assert.equal(
                (
                    await call(
                        '/api/customer/appointments/' + stored._id + '/cancel',
                        other.token,
                        'PATCH',
                    )
                ).status,
                409,
            );
            assert.equal(
                (
                    await call(
                        '/api/admin/appointments/' + stored._id + '/confirm',
                        admin.token,
                        'PATCH',
                    )
                ).status,
                200,
            );
            assert.equal(
                (await call('/api/customer/appointments', customer.token, 'POST', booking)).status,
                409,
            );
            assert.equal(
                (
                    await call(
                        '/api/customer/appointments/' + stored._id + '/cancel',
                        customer.token,
                        'PATCH',
                    )
                ).status,
                409,
            );
            const otherList = await call('/api/customer/appointments', other.token);
            assert.ok(otherList.data.bookings.every((item) => item.userId === other.id));
            console.log(
                'PASS: personal ownership, server pricing, predefined slots and duplicate pending/confirmed protection',
            );

            let checkout;
            if (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
                const payment = await call(
                    '/api/customer/appointments/' + stored._id + '/checkout',
                    customer.token,
                    'POST',
                );
                assert.equal(payment.status, 200, payment.data.message);
                assert.ok(payment.data.url.startsWith('https://checkout.stripe.com/'));
                checkoutId = (await serviceBookingcollection.findOne({ _id: stored._id }))
                    .checkoutSessionId;
                const again = await call(
                    '/api/customer/appointments/' + stored._id + '/checkout',
                    customer.token,
                    'POST',
                );
                assert.equal(again.data.url, payment.data.url);
                checkout = await stripe.checkout.sessions.retrieve(checkoutId);
                assert.equal(checkout.amount_total, 500);
                assert.equal(
                    (await call('/api/checkout-session/' + checkoutId, customer.token)).status,
                    200,
                );
                assert.equal(
                    (await call('/api/checkout-session/' + checkoutId, other.token)).status,
                    404,
                );
                assert.equal(
                    (await serviceBookingcollection.findOne({ _id: stored._id })).paymentStatus,
                    'unpaid',
                );
                console.log(
                    'PASS: real Stripe test-mode checkout creation/reuse; checkout GET cannot mark payment paid',
                );
            } else {
                checkout = {
                    id: 'cs_test_fixture_' + run,
                    amount_total: 500,
                    currency: 'usd',
                    metadata: { bookingId: stored._id.toString(), userId: customer.id },
                };
            }
            const event = {
                id: 'evt_fixture_' + run,
                type: 'checkout.session.completed',
                created: Math.floor(Date.now() / 1000),
                data: {
                    object: {
                        ...checkout,
                        payment_status: 'paid',
                        payment_intent: 'pi_fixture_' + run,
                    },
                },
            };
            const payload = JSON.stringify(event);
            const sendWebhook = (signature) =>
                fetch(apiUrl + '/api/webhooks/stripe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
                    body: payload,
                });
            assert.equal((await sendWebhook('invalid')).status, 400);
            assert.equal(
                (await serviceBookingcollection.findOne({ _id: stored._id })).paymentStatus,
                'unpaid',
            );
            // A verified failure is recorded without granting paid status.
            const failurePayload = JSON.stringify({
                ...event,
                type: 'checkout.session.async_payment_failed',
                data: { object: { ...checkout, payment_status: 'unpaid' } },
            });
            const failureSignature = stripe.webhooks.generateTestHeaderString({
                payload: failurePayload,
                secret: process.env.STRIPE_WEBHOOK_SECRET,
            });
            const sendFailure = () =>
                fetch(apiUrl + '/api/webhooks/stripe', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'stripe-signature': failureSignature,
                    },
                    body: failurePayload,
                });
            assert.equal((await sendFailure()).status, 200);
            assert.equal(
                (await transactionCollection.findOne({ stripeSessionId: checkout.id })).status,
                'failed',
            );
            assert.equal(
                (await serviceBookingcollection.findOne({ _id: stored._id })).paymentStatus,
                'unpaid',
            );
            const signature = stripe.webhooks.generateTestHeaderString({
                payload,
                secret: process.env.STRIPE_WEBHOOK_SECRET,
            });
            assert.equal((await sendWebhook(signature)).status, 200);
            assert.equal((await sendWebhook(signature)).status, 200);
            assert.equal(
                (await serviceBookingcollection.findOne({ _id: stored._id })).paymentStatus,
                'paid',
            );
            assert.equal(
                await transactionCollection.countDocuments({ stripeSessionId: checkout.id }),
                1,
            );
            assert.equal((await sendFailure()).status, 200);
            assert.equal(
                (await transactionCollection.findOne({ stripeSessionId: checkout.id })).status,
                'paid',
            );
            const transactions = await call('/api/admin/transactions', admin.token);
            assert.ok(
                transactions.data.some(
                    (item) => item.stripeSessionId === checkout.id && item.amount === 5,
                ),
            );
            console.log(
                'PASS: invalid webhook signatures rejected; valid replay creates one transaction and updates payment status',
            );

            assert.equal(
                (
                    await call(
                        '/api/admin/appointments/' + stored._id + '/cancel',
                        admin.token,
                        'PATCH',
                    )
                ).status,
                200,
            );
            assert.equal(
                (await serviceBookingcollection.findOne({ _id: stored._id })).paymentStatus,
                'paid',
            );
            assert.equal(
                (await call('/api/customer/appointments', customer.token, 'POST', booking)).status,
                201,
            );
            const pending = await serviceBookingcollection.findOne({
                serviceId,
                status: 'pending',
            });
            assert.equal(
                (
                    await call(
                        '/api/customer/appointments/' + pending._id + '/cancel',
                        customer.token,
                        'PATCH',
                    )
                ).status,
                200,
            );
            console.log(
                'PASS: admin cancellation preserves payment history; cancellation releases the slot',
            );

            const profile = await call('/api/customer/profile', customer.token, 'PATCH', {
                name: 'Updated Test',
                phone: '+880 1712345678',
                image: 'https://example.com/profile.jpg',
                role: 'admin',
                id: other.id,
            });
            assert.equal(profile.status, 200);
            assert.equal(profile.data.profile.id, customer.id);
            assert.equal(
                (await userCollection.findOne({ _id: new ObjectId(customer.id) })).role,
                'user',
            );
            assert.equal(
                (
                    await call('/api/admin/users/' + customer.id, admin.token, 'PATCH', {
                        isBlocked: true,
                    })
                ).status,
                200,
            );
            assert.equal((await call('/api/customer/overview', customer.token)).status, 401);
            assert.equal(
                (
                    await call('/api/admin/users/' + customer.id, admin.token, 'PATCH', {
                        isBlocked: false,
                    })
                ).status,
                200,
            );
            assert.equal((await call('/api/customer/overview', customer.token)).status, 401);
            console.log(
                'PASS: own-profile-only updates, role protection, blocking and revoked sessions',
            );

            const sorted = await call('/api/services?sort=price-asc');
            assert.equal(sorted.status, 200);
            assert.ok(
                sorted.data.every(
                    (item, index, all) =>
                        item.status === 'active' && (!index || all[index - 1].price <= item.price),
                ),
            );
            const search = await call('/api/services?search=' + encodeURIComponent(service.name));
            assert.ok(search.data.some((item) => item._id === serviceId));
            const pages = [
                ['overview', 'Salon Overview'],
                ['manage-services', 'Manage Salon Services'],
                ['add-services', 'Add New Service'],
                ['manage-appointments', 'Manage Appointments'],
                ['manage-users', 'Manage Customers'],
                ['transactions', 'Transactions'],
                ['my-profile', 'Profile'],
            ];
            for (const [path, title] of pages) {
                const response = await fetch(clientUrl + '/dashboard/admin/' + path, {
                    headers: { Cookie: admin.cookie },
                });
                const html = await response.text();
                assert.equal(response.status, 200, path);
                assert.ok(html.includes(title), path + ' did not render');
                assert.ok(!html.includes('Failed to load'), path + ' has a failed API request');
            }
            const wrongRole = await fetch(clientUrl + '/dashboard/admin/manage-users', {
                redirect: 'manual',
                headers: { Cookie: other.cookie },
            });
            const roleHtml = await wrongRole.text();
            assert.ok(
                (wrongRole.headers.get('location') || roleHtml).includes(
                    '/dashboard/customer/overview',
                ),
            );
            for (const route of ['overview', 'my-appointments', 'my-profile']) {
                const response = await fetch(clientUrl + '/dashboard/customer/' + route, {
                    headers: { Cookie: other.cookie },
                });
                const html = await response.text();
                assert.equal(response.status, 200, route);
                assert.ok(
                    !html.includes('Failed to fetch') && !html.includes('Unable to load'),
                    route,
                );
            }
            assert.equal(
                (await call('/api/services/' + serviceId, admin.token, 'DELETE')).status,
                200,
            );
            console.log(
                'PASS: public price sorting/search and authenticated admin dashboard rendering',
            );
        } finally {
            if (checkoutId && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
                try {
                    const checkout = await stripe.checkout.sessions.retrieve(checkoutId);
                    if (checkout.status === 'open')
                        await stripe.checkout.sessions.expire(checkoutId);
                } catch {}
            }
            await transactionCollection.deleteMany({ customerId: { $in: userIds } });
            if (serviceId) {
                await serviceBookingcollection.deleteMany({ serviceId });
                await serviceCollection.deleteOne({ _id: new ObjectId(serviceId) });
            }
            const references = [...userIds, ...userIds.map((id) => new ObjectId(id))];
            await db.collection('session').deleteMany({ userId: { $in: references } });
            await db.collection('account').deleteMany({ userId: { $in: references } });
            await userCollection.deleteMany({
                _id: { $in: userIds.map((id) => new ObjectId(id)) },
                email: { $regex: '^salonbook-test-' },
            });
            await db.client.close();
        }
    },
);
