import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogDetails } from './CatalogDetails';
import type { CatalogProduct } from '../shared/types';
const product: CatalogProduct = { productId:'9NBLGGH4R315', title:'Example game', description:'Store description', categories:['Racing'], installability:'unsupported', supportNote:'No compatible PC package' };
const props = {product,back:()=>{},install:()=>{},busy:false,installed:false,queued:false,canInstall:false,openInstalled:()=>{}};
it('opens a dedicated information page and keeps unsupported installation disabled', () => {
 const html=renderToStaticMarkup(<CatalogDetails {...props} />);
 expect(html).toContain('Store description');
 expect(html).toContain('role="tablist"');
 expect(html).toContain('disabled=""');
 expect(html).not.toContain('SELECTED PRODUCT');
});
it('offers the library for an installed product rather than another installation', () => {
 const html=renderToStaticMarkup(<CatalogDetails {...props} installed />);
 expect(html).toContain('View in library');
 const primary = html.match(/<button class="primary"[^>]*>/)?.[0];
 expect(primary).toBeDefined();
 expect(primary).not.toContain('disabled=');
});
