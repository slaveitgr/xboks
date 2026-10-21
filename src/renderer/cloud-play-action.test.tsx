import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CloudAccountCatalog} from '../shared/cloud-stream';
import {CloudPlayAction, entitledCloudProduct} from './CloudPlayAction';

const base = '9NNX1VVR3KNQ', edition = '9NKX70BBCDRN';
const account: CloudAccountCatalog = {status:'ready', titles:[{productId:base,titleId:'server-title',hasEntitlement:true,supportedInputTypes:['controller'],programs:[]}], recentProductIds:[],checkedAt:''};
it('requires explicit authenticated cloud entitlement, independent of a subscription badge', () => {
  expect(entitledCloudProduct(account,base)).toBe(base);
  for (const hasEntitlement of [false,undefined]) expect(entitledCloudProduct({...account,titles:[{...account.titles[0],hasEntitlement}]},base)).toBeUndefined();
  for (const status of ['signed-out','error','unsupported'] as const) expect(entitledCloudProduct({...account,status},base)).toBeUndefined();
  expect(entitledCloudProduct(account,edition)).toBeUndefined();
  expect(entitledCloudProduct(account,edition,base)).toBe(base);
  expect(entitledCloudProduct(account,undefined,'not-a-product')).toBeUndefined();
});
it('renders the original Cloud action beside installation only for the current signed-in account', () => {
  const props = {productId:edition,primaryProductId:base,account,auth:{stored:true,running:false,note:''},onPlay:async()=>{}};
  const html = renderToStaticMarkup(<CloudPlayAction {...props}/>);
  expect(html).toContain('Play with Cloud'); expect(html).toContain('cloud-play-action');
  expect(renderToStaticMarkup(<CloudPlayAction {...props} auth={{stored:false,running:false,note:''}}/>)).toBe('');
  expect(renderToStaticMarkup(<CloudPlayAction {...props} accountLoading/>)).toBe('');
  expect(renderToStaticMarkup(<CloudPlayAction {...props} auth={{stored:true,running:true,note:''}}/>)).toBe('');
});
