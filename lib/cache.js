import { unstable_cache } from 'next/cache';
import { cache as reactCache } from 'react';

export function cacheData(callback, tags) {
    return reactCache(
        unstable_cache(callback, tags, {
            revalidate: false,
            tags: tags,
        })
    );
}