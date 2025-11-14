export function colorText_noti({ key }) {
    if (key == 'blue') {
        return { color: 'var(--main_d)', background: '#e3f1ff' }
    }
    else if (key == 'yellow') {
        return { color: '#c39200', background: 'rgb(249 255 227)' }
    }
    else {
        return { color: 'var(--text-primary)', background: 'var(--bg-secondary)' }
    }
}