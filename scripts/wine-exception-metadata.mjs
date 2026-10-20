// Extract only structured exception metadata and validated RTTI symbols, never exception messages,
// OutputDebugString text, stack memory, headers or response bodies.
const prefix = /^([0-9a-f]{4,8}):(trace|warn):seh:([A-Za-z0-9_]+) (.*)$/i;
const numeric = /^(?:info\[[0-9]{1,2}\]=[0-9a-f]{8,16}|(?:rip|rax|rsi|r10|r14)=[0-9a-f]{8,16}(?: {1,2}[A-Za-z0-9]+=[0-9a-f]{2,16})*)$/i;
const categories = new Map([
  ['.?AVexception@std@@', 'std-exception'],
  ['.?AVbad_alloc@std@@', 'std-bad_alloc'],
  ['.?AVbad_function_call@std@@', 'std-bad_function_call'],
  ['.?AVsystem_error@std@@', 'std-system_error'],
  ['.?AVruntime_error@std@@', 'std-runtime_error'],
  ['.?AVlogic_error@std@@', 'std-logic_error'],
  ['.?AVinvalid_argument@std@@', 'std-invalid_argument'],
  ['.?AVout_of_range@std@@', 'std-out_of_range'],
  ['.?AVlength_error@std@@', 'std-length_error'],
  ['.?AVfuture_error@std@@', 'std-future_error'],
]);

export function exceptionMetadata(line) {
  const match = prefix.exec(line);
  if (!match) return null;
  const [, thread, level, fn, body] = match;
  if (level === 'trace' && fn === 'dispatch_exception' && numeric.test(body.trim()))
    return `[exception-context] thread=${thread} ${body.trim()}`;
  if (level === 'warn' && fn === 'virtual_unwind') {
    const frame = /^backtrace: ([0-9a-f]{16}): L"([A-Za-z0-9_. -]{1,80}\.(?:dll|exe))" \+ ([0-9a-f]{16})\.$/i.exec(body);
    if (frame) return `[exception-frame] thread=${thread} pc=${frame[1]} module=${frame[2]} rva=${frame[3]}`;
    const unknown = /^backtrace: ([0-9a-f]{16}): unknown module\.$/i.exec(body);
    if (unknown) return `[exception-frame] thread=${thread} pc=${unknown[1]} module=unknown`;
  }
  if (level === 'trace' && /^(?:cxx_frame_handler|cxx_frame_handler4)$/.test(fn)) {
    const type = /^\s*([0-9]{1,2}): flags [0-9a-f]+ type [0-9a-f]+ \{vtable=[0-9a-f]+ name=(\S+) \([^\n]*\)\} offsets -?[0-9]+,-?[0-9]+,-?[0-9]+ size [0-9]+ copy ctor [0-9a-f]+$/i.exec(body);
    if (type) {
      const category = categories.get(type[2]) ?? 'unclassified';
      // RTTI is a compiler-generated class symbol, not exception.what(). Keep
      // only bounded MSVC class symbols; discard the demangled parenthesized
      // text entirely. Unknown/malformed input never becomes a free-text log.
      const rtti = /^\.\?A[VU][A-Za-z0-9_?$@]{1,240}@@$/.test(type[2])
        ? ` rtti=${type[2]}` : '';
      return `[exception-type] thread=${thread} index=${type[1]} category=${category}${rtti}`;
    }
    if (/^handling C\+\+ exception rec [0-9a-f]{8,16} frame [0-9a-f]{1,16} descr [0-9a-f]{8,16}$/i.test(body))
      return `[exception-handler] thread=${thread} ${body}`;
    if (body === 'rethrow detected.') return `[exception-handler] thread=${thread} rethrow`;
  }
  return null;
}

// XAsync lifecycle only: pointer/size/status fields, never provider data,
// identityName text, results, credentials, or arbitrary GDK trace output.
export function asyncMetadata(line) {
  const result = /^([0-9a-f]{4,8}):trace:gdkc:(?:x_threading_XAsyncBegin|async_work_callback) provider ([0-9a-f]{8,16}), op ([01]), asyncBlock ([0-9a-f]{8,16}) -> result ((?:0x)?[0-9a-f]{1,8})\.$/i.exec(line);
  if (result) return `[async-provider] thread=${result[1]} provider=${result[2]} op=${result[3]} block=${result[4]} result=${result[5]}`;
  const match = /^([0-9a-f]{4,8}):trace:gdkc:x_threading_(XAsync[A-Za-z]+) (.*)$/i.exec(line);
  if (!match) return null;
  const [, thread, fn, body] = match;
  if (fn === 'XAsyncBegin') {
    const begin = /^iface ([0-9a-f]{8,16}), asyncBlock ([0-9a-f]{8,16}), context ([0-9a-f]{8,16}), identity ([0-9a-f]{8,16}), identityName [^\n]{0,256}, provider ([0-9a-f]{8,16})\.$/i.exec(body);
    if (begin) return `[async-metadata] thread=${thread} op=Begin block=${begin[2]} context=${begin[3]} identity=${begin[4]} provider=${begin[5]}`;
    return null;
  }
  const forms = {
    XAsyncSchedule: /^iface [0-9a-f]{8,16}, asyncBlock [0-9a-f]{8,16}, delayInMs [0-9]+\.$/i,
    XAsyncCancel: /^iface [0-9a-f]{8,16}, asyncBlock [0-9a-f]{8,16}\.$/i,
    XAsyncComplete: /^iface [0-9a-f]{8,16}, asyncBlock [0-9a-f]{8,16}, result (?:0x)?[0-9a-f]{1,8}, requiredBufferSize [0-9]+\.$/i,
    XAsyncGetResult: /^iface [0-9a-f]{8,16} asyncBlock [0-9a-f]{8,16}, identity [0-9a-f]{8,16}, bufferSize [0-9]+, buffer [0-9a-f]{8,16}, bufferUsed [0-9a-f]{8,16}\.$/i,
    XAsyncGetResultSize: /^iface [0-9a-f]{8,16}, asyncBlock [0-9a-f]{8,16}, bufferSize [0-9a-f]{8,16}\.$/i,
    XAsyncGetStatus: /^asyncBlock [0-9a-f]{8,16} -> status (?:0x)?[0-9a-f]{1,8}\.$/i,
  };
  if (forms[fn]?.test(body)) return `[async-metadata] thread=${thread} op=${fn.slice(6)} ${body}`;
  return null;
}
