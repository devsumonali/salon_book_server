import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import { db, userCollection } from '../config/database.js';

const authUrl = (process.env.AUTH_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
);
const keys = createRemoteJWKSet(new URL(authUrl + '/api/auth/jwks'));

// 1. Verify the JWT signature, issuer, audience, expiry, and current login session.
export const verifyToken = async (req, res, next) => {
    try {
        const authorization = req.get('authorization');
        if (!authorization?.startsWith('Bearer '))
            return res.status(401).send({ message: 'Please sign in' });
        const { payload } = await jwtVerify(authorization.slice(7), keys, {
            issuer: authUrl,
            audience: authUrl,
            algorithms: ['EdDSA'],
        });

        if (!ObjectId.isValid(payload.sub || '') || !ObjectId.isValid(payload.sessionId || ''))
            return res.status(401).send({
                message: 'Invalid login token',
            });
        const session = await db.collection('session').findOne({
            _id: new ObjectId(payload.sessionId),
            expiresAt: {
                $gt: new Date(),
            },
        });
        if (!session || session.userId.toString() !== payload.sub)
            return res.status(401).send({
                message: 'Please sign in again',
            });

        const user = await userCollection.findOne({
            _id: new ObjectId(payload.sub),
        });
        if (!user) return res.status(401).send({ message: 'Account not found' });

        if (user.isBlocked) return res.status(403).send({ message: 'Your account is blocked' });
        req.user = {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            role: user.role || 'user',
        };
        res.set('Cache-Control', 'no-store');
        next();
    } catch (error) {
        const status = typeof error.code === 'string' && error.code.startsWith('ERR_') ? 401 : 503;
        res.status(status).send({
            message:
                status === 401
                    ? 'Invalid or expired login token'
                    : 'Unable to verify login. Please try again.',
        });
    }
};

// 2. Apply the role check after verifyToken, not just in the frontend sidebar.
export const requireAdmin = (req, res, next) =>
    req.user.role === 'admin' ? next() : res.status(403).send({ message: 'Admin access required' });
export const requireCustomer = (req, res, next) =>
    req.user.role === 'user'
        ? next()
        : res.status(403).send({ message: 'Only customers can book appointments' });
