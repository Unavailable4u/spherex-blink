const canvas = document.getElementById('viewer');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#111';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#6cf';
ctx.fillText('Canvas works', 20, 30);