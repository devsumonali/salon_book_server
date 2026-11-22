import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceData } from '../src/lib/service-data.js';

const valid = {
    name: 'Haircut',
    description: 'A professional haircut.',
    category: 'hair-styling',
    price: 25,
    duration: 30,
    image: 'https://example.com/hair.jpg',
};

test('New services default to active and accept only permitted fields', () => {
    const result = serviceData({ ...valid, _id: 'injected', role: 'admin' }, true);
    assert.equal(result.error, undefined);
    assert.equal(result.data.status, 'active');
    assert.equal(result.data._id, undefined);
    assert.equal(result.data.role, undefined);
});

test('Services reject invalid prices, durations, categories and images', () => {
    for (const change of [
        { price: 0 },
        { price: -1 },
        { price: '25' },
        { duration: 0 },
        { duration: 1.5 },
        { category: 'unknown' },
        { image: 'javascript:alert(1)' },
        { name: '' },
    ]) {
        assert.ok(serviceData({ ...valid, ...change }, true).error);
    }
});

test('A status-only update does not overwrite the rest of the service', () => {
    assert.deepEqual(serviceData({ status: 'inactive' }), { data: { status: 'inactive' } });
    assert.ok(serviceData({}).error);
});
