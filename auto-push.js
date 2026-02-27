import { spawn } from 'child_process';

const child = spawn('pnpm', ['db:push'], {
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
    const output = data.toString();
    process.stdout.write(output);
    if (output.includes('created or renamed') || output.includes('❯')) {
        child.stdin.write('\n');
    }
});

child.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
});

child.on('close', (code) => {
    console.log(`Process exited with code ${code}`);
});
