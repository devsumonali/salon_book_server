import { serviceCollection, db } from '../src/config/database.js';

// Add only enough demo services to meet the six-active-services requirement.
const samples = [
    [
        'Signature Haircut & Styling',
        'hair-styling',
        55,
        60,
        'photo-1562322140-8baeececf3df',
        'A tailored haircut and professional finish for your everyday style.',
    ],
    [
        'Botanical Glow Facial',
        'skin-care',
        65,
        45,
        'photo-1570172619644-dfd03ed5d881',
        'Gentle cleansing, a nourishing mask, and a refreshing skincare ritual.',
    ],
    [
        'Balayage & Color Refresh',
        'hair-color',
        120,
        90,
        'photo-1562322140-8baeececf3df',
        'Natural-looking dimension and a personalized color refresh.',
    ],
    [
        'Classic Manicure',
        'nail-care',
        35,
        45,
        'photo-1604654894610-df63bc536371',
        'Shape, cuticle care, and a polished finish for your hands.',
    ],
    [
        'Restorative Body Ritual',
        'wellness',
        85,
        60,
        'photo-1544161515-4ab6ce6db874',
        'A relaxing body treatment and a quiet moment of care.',
    ],
    [
        'Essential Hair Styling',
        'hair-styling',
        40,
        45,
        'photo-1562322140-8baeececf3df',
        'A professional blow-dry and finish for your next occasion.',
    ],
];
try {
    let count = await serviceCollection.countDocuments({ status: 'active' });
    for (const [name, category, price, duration, photo, description] of samples) {
        if (count >= 6) break;
        const result = await serviceCollection.updateOne(
            { name },
            {
                $setOnInsert: {
                    name,
                    category,
                    price,
                    duration,
                    description,
                    image:
                        'https://images.unsplash.com/' + photo + '?auto=format&fit=crop&w=640&q=80',
                    status: 'active',
                    createdAt: new Date(),
                },
            },
            { upsert: true },
        );
        if (result.upsertedCount) count++;
    }
    console.log('Active services:', count);
} finally {
    await db.client.close();
}
