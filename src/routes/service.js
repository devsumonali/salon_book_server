import { Router } from 'express';
import { serviceCollection } from '../config/database.js';
import { ObjectId } from 'mongodb';

const router = Router();

//service post api create
router.post('/api/services', async (req, res) => {
    try {
        const data = req.body;
        if (typeof data.image !== 'string' || !data.image.startsWith('https://')) {
            return res.status(400).send({
                message: 'A valid image URL is required',
            });
        }
        const result = await serviceCollection.insertOne(data);

        res.status(201).send({ result });
    } catch (error) {
        res.status(500).send({
            message: 'service crated problem',
        });
    }
});

//service get api create
router.get('/api/services', async (req, res) => {
    const cursor = serviceCollection.find();
    const result = await cursor.toArray();
    res.send(result);
});

//single service api
router.get('/api/services/:id', async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await serviceCollection.findOne(query);
    res.send(result);
});

//service update api create
router.patch('/api/services/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const update = req.body;

        const filter = { _id: new ObjectId(id) };

        const updateDocs = {
            $set: update,
        };

        const result = await serviceCollection.updateOne(filter, updateDocs);

        res.send(result);
    } catch (error) {
        console.log('Service update error:', error);

        res.status(500).send({
            message: 'Failed to update service',
        });
    }
});

export default router;
