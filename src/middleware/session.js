import { ObjectId } from 'mongodb';
import { db } from '../config/database.js';

export const requireSession = async (req, res, next) => {
    try {
        const authorization = req.get('authorization');
        const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
        const session =
            token &&
            (await db.collection('session').findOne({ token, expiresAt: { $gt: new Date() } }));
        if (!session?.userId || !ObjectId.isValid(session.userId.toString())) {
            return res.status(401).send({ message: 'Please sign in again' });
        }
        const user = await db
            .collection('user')
            .findOne({ _id: new ObjectId(session.userId.toString()) });
        if (!user) return res.status(401).send({ message: 'Please sign in again' });
        req.user = {
            id: session.userId.toString(),
            name: user.name,
            email: user.email,
            role: user.role,
        };
        res.set('Cache-Control', 'no-store');
        next();
    } catch (error) {
        res.status(500).send({ message: 'Unable to verify your session' });
    }
};
