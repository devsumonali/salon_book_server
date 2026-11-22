// Validate only permitted fields. Ignore IDs and arbitrary request-body properties.
export const serviceData = (body, creating = false) => {
    const data = {};
    const categories = ['hair-styling', 'hair-color', 'skin-care', 'nail-care', 'wellness'];
    for (const field of [
        'name',
        'description',
        'category',
        'price',
        'duration',
        'image',
        'status',
    ]) {
        const value = body?.[field];
        if (value === undefined) {
            if (creating && field !== 'status') return { error: field + ' is required' };
            continue;
        }
        if (
            ['name', 'description'].includes(field) &&
            (typeof value !== 'string' ||
                !value.trim() ||
                value.length > (field === 'name' ? 150 : 3000))
        )
            return { error: 'Enter a valid ' + field };
        if (
            ['price', 'duration'].includes(field) &&
            (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        )
            return { error: field + ' must be a positive number' };
        if (field === 'duration' && !Number.isInteger(value))
            return { error: 'Duration must be a whole number of minutes' };
        if (field === 'category' && !categories.includes(value))
            return { error: 'Choose a valid category' };
        if (field === 'status' && !['active', 'inactive'].includes(value))
            return { error: 'Choose a valid service status' };
        if (field === 'image') {
            try {
                if (typeof value !== 'string' || new URL(value).protocol !== 'https:')
                    return { error: 'Upload a valid service image' };
            } catch {
                return { error: 'Upload a valid service image' };
            }
        }
        data[field] = typeof value === 'string' ? value.trim() : value;
    }
    if (creating) {
        data.status ||= 'active';
        data.createdAt = new Date();
    }
    if (!Object.keys(data).length) return { error: 'No service fields to update' };
    return { data };
};
