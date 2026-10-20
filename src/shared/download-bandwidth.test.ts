import {expect,it} from 'vitest';
import {downloadLimitArgs,downloadLimitCommand,downloadLimitKiB} from './download-bandwidth.js';
it('converts explicit binary units, preserves unlimited, and rejects invalid or silently unlimited rates',()=>{
  expect(downloadLimitKiB(undefined)).toBe(0);expect(downloadLimitKiB(0)).toBe(0);expect(downloadLimitKiB(0.5)).toBe(512);
  expect(downloadLimitKiB(0.1)).toBe(102);expect(downloadLimitKiB(1024)).toBe(1048576);
  for(const value of [NaN,Infinity,-1,'10',null,1025,0.0001])expect(()=>downloadLimitKiB(value)).toThrow();
});
it('requires actual capability before sending flags or starting a requested limited transfer',()=>{
  expect(downloadLimitArgs(undefined,{})).toEqual([]);expect(downloadLimitArgs(0,{})).toEqual([]);
  expect(()=>downloadLimitArgs(10,{})).toThrow('was not started without its limit');
  expect(downloadLimitArgs(0,{streamingBandwidthLimit:true})).toEqual(['--download-limit-kib','0']);
  expect(downloadLimitArgs(10,{streamingBandwidthLimit:true})).toEqual(['--download-limit-kib','10240']);
  expect(JSON.parse(downloadLimitCommand(1.5))).toEqual({schema:1,command:'set-download-limit',kibPerSecond:1536});
});
