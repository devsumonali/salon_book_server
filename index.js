import app from './src/app.js';
import { connectToMongoDB } from './src/config/database.js';

const port = 8000;

export { connectToMongoDB };

await connectToMongoDB();

app.listen(port, () => {
    console.log(`Server running at ${port}`);
});
