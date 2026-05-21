
async function test() {
    const url = 'http://localhost:3001/api/prices';
    try {
        const res = await fetch(url);
        const data = await res.json();
        console.log('Prices:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
