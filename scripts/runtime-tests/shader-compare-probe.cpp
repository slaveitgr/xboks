/* SPDX-License-Identifier: MIT
 * Exact pinned DXBC-SPIRV public arithmetic pass, with assertions enabled.
 * No shader from a game, account, network or GPU is used.
 */
#include <cstdio>
#include "ir/ir_builder.h"
#include "ir/passes/ir_pass_arithmetic.h"
using namespace dxbc_spv::ir;
static unsigned checks,failures;
#define CHECK(x) do {++checks;if(!(x)){++failures;std::printf("FAIL line=%u\n",__LINE__);}}while(0)
static void compare(OpCode find,bool unequal,int constant) {
  Builder builder;
  auto fn=builder.add(Op::Function(ScalarType::eBool));
  auto ep=builder.add(Op::EntryPoint(fn,ShaderStage::eCompute));
  auto first=builder.add(Op::DclInput(ScalarType::eU32,ep,0,0));
  auto second=builder.add(Op::DclInput(ScalarType::eU32,ep,1,0));
  auto zero=builder.makeConstant(uint32_t(0));
  builder.add(Op::Label());
  auto input=builder.add(Op::InputLoad(ScalarType::eU32,first,zero));
  auto bit=builder.add(Op(find,ScalarType::eU32).addOperand(input));
  // Keep the nonconstant comparison operand AFTER find in SSA order. This is
  // the normal form that reaches the previously broken public transform.
  auto rhs=constant<0?builder.add(Op::InputLoad(ScalarType::eU32,second,zero)):
    builder.makeConstant(uint32_t(constant));
  auto cmp=builder.add(unequal?Op::INe(ScalarType::eBool,bit,rhs):Op::IEq(ScalarType::eBool,bit,rhs));
  auto result=builder.add(Op::Return(ScalarType::eBool,cmp));
  builder.add(Op::FunctionEnd());
  unsigned passes=0;
  while(ArithmeticPass::runPass(builder,{}))if(++passes>30){CHECK(false);return;}
  CHECK(passes<=30);
  const auto& returned=builder.getOpForOperand(builder.getOp(result),0);
  if(constant>=32) {
    CHECK(returned.isConstant());
    if(returned.isConstant())CHECK(bool(returned.getOperand(0))==unequal);
  }else CHECK(!returned.isConstant());
}
int main() {
  for(auto find:{OpCode::eUFindMsb,OpCode::eSFindMsb,OpCode::eIFindLsb})
    for(bool unequal:{false,true})for(int constant:{-1,0,31,32,64})compare(find,unequal,constant);
  std::printf("SHADER CHECKS %u FAILURES %u\n",checks,failures);
  return failures?1:0;
}
