# Hermes v96 switch and exception boundary audit

This is a separate structural audit of the supplied Xbox **2610.1001.20.0 x64** `index.bundle`. It closes the switch-table and exception-range coverage gaps identified in [the function evidence chapter](bytecode-analysis.md). It does not recover full semantic control flow, execute the application or establish Windows runtime parity. After the producer's switch-leader correction, fresh generation produced byte-identical function-evidence JSONL; its summary's scope note was updated.

## Results on the reference input

Input SHA-256: `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`.

| Check | Result |
| --- | ---: |
| Functions and instruction bodies rechecked | 68,878 / 2,541,891 |
| Overflow/large function headers decoded | 13 |
| Ordinary Addr-operand edges rechecked | 170,039 |
| `SwitchImm` instructions / case-table entries | 23 / 586 |
| Switch default targets checked | 23 |
| Functions with exception tables | 2,758 |
| Exception entries checked | 4,126 |
| Exception targets whose first opcode is `Catch` | 4,126 |
| Functions flagging debug-offset records | 0 |
| Invalid ranges, targets, instruction boundaries or bounded reads | 0 |

The 23 switch defaults are already included in the ordinary Addr-operand count. Exception entries describe protected ranges and handler destinations; they are not a claim that every instruction in the interval throws. Zero errors establishes consistency of the encoded structures with the checked format, not semantic completeness.

## Decoding rules and provenance

The definitions are pinned to **facebook/hermes v0.13.0**, the matching v96 format. [BytecodeFileFormat.h](https://github.com/facebook/hermes/blob/v0.13.0/include/hermes/BCGen/HBC/BytecodeFileFormat.h) defines the compact/overflow headers and three-field exception entries. The packed struct declaration and [packing macros](https://github.com/facebook/hermes/blob/v0.13.0/external/llvh/include/llvh/Support/Compiler.h) establish a **31-byte** large function header. The subsequent exception table is aligned to four bytes as specified by [BytecodeDataProvider.cpp](https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/BytecodeDataProvider.cpp).

For an ordinary compact function, the information region begins at its `infoOffset`. For an overflow function, the reader reconstructs the large-header address, validates its packed fields/flags, skips 31 bytes and then aligns the following information. It follows the provider's behavior rather than following the large header's `infoOffset` a second time.

Switch-table behavior follows the pinned [Interpreter.cpp](https://github.com/facebook/hermes/blob/v0.13.0/lib/VM/Interpreter.cpp) implementation. The table begins at `align4(absolute_opcode_address + operand2)`. The minimum/maximum case values are inclusive; each table entry is a **signed** 32-bit displacement from the switch opcode. The default is another opcode-relative displacement. Alignment must use the absolute bundle address because individual function bodies need not start on a four-byte boundary.

The [serializer](https://github.com/facebook/hermes/blob/v0.13.0/lib/BCGen/HBC/BytecodeStream.cpp) places a function's switch payload after its instruction block. The audit therefore bounds each table after that bytecode and before the next distinct function body or the function-information region. Identical deduplicated bodies may share a body address; the boundary computation uses distinct addresses.

Exception-table reads are bounded by the next distinct function-information region, the debug section and the file footer. Protected ranges must satisfy `0 <= start < end <= bytecode_size`; `start` must be an instruction start and `end` an instruction start or the body's exclusive end. Targets must be instruction starts. The provider uses **`[start,end)`** and searches entries in stored order; the report preserves that order and does not flatten overlapping/nested ranges.

## Reproduce

```sh
python3 scripts/analysis/audit-hermes96-control-flow.py \
  work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def \
  --metadata work/reference/hermes96-decoded.json \
  --private-output work/reference/library/control-flow.json

python3 scripts/analysis/test-hermes96-control-flow.py
```

The CLI freshly validates the Hermes header/footer and function metadata. If the optional metadata JSON differs from that fresh parse, it stops. Unsupported or invalid structures produce explicit error rows and a nonzero exit status. No bytecode or Windows package code is executed.

Twelve synthetic tests cover compact and overflow headers, packed-header alignment, mismatched flags, absolute switch alignment, signed backward case displacements, default/case instruction boundaries, table reads crossing into the next payload, malformed case ranges, exception-table counts, exclusive function-end ranges, nested range order, invalid handler endpoints and complete audit integration. They need no proprietary package.

Private report schema **1**, stored under ignored local storage:

| Field | Contents |
| --- | --- |
| `bundle_sha256`, `opcode_definition_sha256` | Exact input bindings. |
| `counts`, `errors` | Coverage and explicit rejected structures. |
| `functions[]` | Only functions with switch/exception structures, retaining function ID/name/body bounds. |
| `switches[]` | Instruction/file/table offsets, min/max/default and individual signed case entries/targets. |
| `exceptions` | Table bounds, `[start,end)` marker and entries in original order with handler target opcode. |
| `limitations` | Machine-readable scope restrictions. |

## Remaining scope

The audit found five switch-case entries that were not already ordinary branch leaders: offsets **119, 377 and 473 in function 31178**, and **297 and 344 in function 31218**. A comparison with those leaders included produced the same local call provenance, closure bindings and function/module relationships for the current input. The producer nevertheless now validates and includes case leaders for future inputs. A synthetic cross-case closure alias demonstrates why omitting them could otherwise resolve a false callee. An API caller lacking validated switch leaders receives conservative unknown local provenance for that function.

The audit verifies additional encoded destinations. It does not infer which inputs take a case, which operations throw, how nested handlers affect values, generator resume transitions, asynchronous scheduling, dynamic callees or native-bridge behavior. It also does not parse regex semantics, preserved function-source text or native machine code. This companion report supplies structural evidence without pretending to supply the remaining semantic analysis.
