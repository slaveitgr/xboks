import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogDetails } from './CatalogDetails';
import type { CatalogProduct } from '../shared/types';
const product: CatalogProduct = { productId:'9NBLGGH4R315', title:'Example game', description:'Store description', categories:['Racing'], installability:'unsupported', supportNote:'No compatible PC package' };
const props = {product,back:()=>{},install:()=>{},busy:false,installed:false,queued:false,canInstall:false,openInstalled:()=>{}};
const realDriveNote = 'Microsoft lists a Windows.Universal package (MSIXBUNDLE). XBOKS Engine currently supports only Windows.Desktop MSIXVC installation and launch. UWP/MSIX app packages are not supported yet.';
const primaryButton = (html: string) => html.match(/<button class="primary"[^>]*>/)?.[0];
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
 expect(primary).not.toContain('aria-describedby=');
 expect(html).not.toContain(product.supportNote);
});
it('explains the verified Real Drive package limitation next to disabled Install before opening More', () => {
 const realDrive: CatalogProduct = {...product,productId:'9N4FM1CG341P',title:'Real Drive Simulator',supportNote:realDriveNote};
 const html=renderToStaticMarkup(<CatalogDetails {...props} product={realDrive} />), button=primaryButton(html);
 expect(button).toContain('disabled=""');
 const reason=button?.match(/aria-describedby="([^"]+)"/)?.[1];expect(reason).toBeTruthy();
 const purchase=html.slice(html.indexOf('class="catalog-detail-purchase"'),html.indexOf('class="catalog-detail-media"'));
 expect(purchase).toContain(`<p id="${reason}"`);expect(purchase).toContain('role="note"');expect(purchase).toContain(realDriveNote);
 expect(html).toContain('Installation requires a valid license for the selected game and a compatible PC package.');
 expect(html).not.toContain('No compatible PC package');
});
it.each(['supported','unknown'] as const)('does not present an unsupported reason for %s installation status', installability => {
 const html=renderToStaticMarkup(<CatalogDetails {...props} product={{...product,installability,supportNote:'Unrelated package note'}} canInstall={installability==='supported'} />);
 expect(primaryButton(html)).not.toContain('aria-describedby=');expect(html).not.toContain('Unrelated package note');
 if(installability==='supported')expect(primaryButton(html)).not.toContain('disabled=');else expect(primaryButton(html)).toContain('disabled=');
});
it('gives simultaneous product instances separate accessible installation reasons', () => {
 const html=renderToStaticMarkup(<><CatalogDetails {...props} /><CatalogDetails {...props} /></>);
 const ids=[...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match=>match[1]);
 expect(ids).toHaveLength(2);expect(new Set(ids).size).toBe(2);
 for(const id of ids)expect(html.split(`id="${id}"`)).toHaveLength(2);
});
