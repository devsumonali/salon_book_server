import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { userCollection } from '../../config/database.js';
import { verifyToken } from '../../middleware/verifyToken.js';

const router = Router();
// Both roles can edit their own profile. Never accept a user ID from the request body.
router.use('/api/customer/profile', verifyToken);

const profileDetails = (user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    image: user.image || '',
    phone: user.phone || '',
    createdAt: user.createdAt || null,
    emailVerified: user.emailVerified === true,
});
const profileFields = { name: 1, email: 1, image: 1, phone: 1, createdAt: 1, emailVerified: 1 };

// View the logged-in customer's personal information.
router.get('/api/customer/profile', async (req, res) => {
    try {
        const user = await userCollection.findOne(
            { _id: new ObjectId(req.user.id) },
            { projection: profileFields },
        );
        if (!user) return res.status(404).send({ message: 'Profile not found' });
        res.send(profileDetails(user));
    } catch (error) {
        res.status(500).send({ message: 'Failed to load profile' });
    }
});

// Update only name, profile image, and phone; the session selects the user.
router.patch('/api/customer/profile', async (req, res) => {
    try {
        const { name, image, phone } = req.body || {};
        const update = {};
        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
                return res
                    .status(400)
                    .send({ message: 'Name must be between 1 and 100 characters' });
            update.name = name.trim();
        }
        if (phone !== undefined) {
            if (typeof phone !== 'string')
                return res.status(400).send({ message: 'Please enter a valid phone number' });
            const digits = phone.replace(/\D/g, '');
            if (
                phone.trim() &&
                (!/^[+()\d\s.-]+$/.test(phone) || digits.length < 7 || digits.length > 15)
            )
                return res.status(400).send({ message: 'Please enter a valid phone number' });
            update.phone = phone.trim();
        }
        if (image !== undefined) {
            if (typeof image !== 'string')
                return res.status(400).send({ message: 'Invalid profile image' });
            if (image) {
                try {
                    if (new URL(image).protocol !== 'https:')
                        return res.status(400).send({ message: 'Profile image must use HTTPS' });
                } catch {
                    return res.status(400).send({ message: 'Invalid profile image URL' });
                }
            }
            update.image = image;
        }
        if (!Object.keys(update).length)
            return res.status(400).send({ message: 'No profile fields to update' });
        const user = await userCollection.findOneAndUpdate(
            { _id: new ObjectId(req.user.id) },
            { $set: { ...update, updatedAt: new Date() } },
            { returnDocument: 'after', includeResultMetadata: false, projection: profileFields },
        );
        if (!user) return res.status(404).send({ message: 'Profile not found' });
        res.send({ message: 'Profile updated successfully', profile: profileDetails(user) });
    } catch (error) {
        res.status(500).send({ message: 'Failed to update profile' });
    }
});

export default router;
