#!/usr/bin/env python3
"""Decode WinMD member signatures and enum constants without loading assemblies.

ECMA-335 Partition II, sections23.1/23.2. This describes metadata contracts,
not native implementations or a portable ABI. Raw output stays in work/reference.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import zipfile

PRIMITIVES={1:'void',2:'bool',3:'char',4:'int8',5:'uint8',6:'int16',7:'uint16',8:'int32',9:'uint32',10:'int64',11:'uint64',12:'float32',13:'float64',14:'string',22:'typedref',24:'native_int',25:'native_uint',28:'object'}

class Reader:
    def __init__(self,data,resolver=None):self.data=bytes(data);self.at=0;self.resolver=resolver or (lambda token:{'coded_index':token})
    def byte(self):
        if self.at>=len(self.data):raise ValueError('Truncated signature')
        value=self.data[self.at];self.at+=1;return value
    def uint(self,with_width=False):
        first=self.byte()
        if first<128:value,bits=first,7
        elif first<192:value,bits=((first&63)<<8)|self.byte(),14
        elif first<224:value,bits=((first&31)<<24)|(self.byte()<<16)|(self.byte()<<8)|self.byte(),29
        else:raise ValueError('Invalid compressed integer prefix')
        return (value,bits) if with_width else value
    def sint(self):
        value,bits=self.uint(True)
        return (value>>1)-(1<<(bits-1)) if value&1 else value>>1
    def type(self,depth=0):
        if depth>32:raise ValueError('Signature nesting exceeds32')
        tag=self.byte()
        if tag in PRIMITIVES:return {'kind':'primitive','name':PRIMITIVES[tag]}
        if tag in (0x11,0x12):return {'kind':'valuetype' if tag==0x11 else 'class','type':self.resolver(self.uint())}
        if tag in (0x0f,0x10,0x1d,0x45):return {'kind':{15:'pointer',16:'byref',29:'szarray',69:'pinned'}[tag],'element':self.type(depth+1)}
        if tag in (0x13,0x1e):return {'kind':'type_parameter' if tag==0x13 else 'method_parameter','index':self.uint()}
        if tag in (0x1f,0x20):return {'kind':'required_modifier' if tag==0x1f else 'optional_modifier','modifier':self.resolver(self.uint()),'element':self.type(depth+1)}
        if tag==0x15:
            base_tag=self.byte()
            if base_tag not in (0x11,0x12):raise ValueError('Invalid generic instance base')
            base=self.resolver(self.uint());count=self.uint()
            if count>1024:raise ValueError('Too many generic arguments')
            return {'kind':'genericinst','base':base,'base_kind':'valuetype' if base_tag==0x11 else 'class','arguments':[self.type(depth+1) for _ in range(count)]}
        if tag==0x14:
            element=self.type(depth+1);rank=self.uint();sizes_count=self.uint()
            if rank<1 or rank>1024 or sizes_count>rank:raise ValueError('Invalid array rank/size count')
            sizes=[self.uint() for _ in range(sizes_count)];bounds_count=self.uint()
            if bounds_count>rank:raise ValueError('Invalid array lower-bound count')
            return {'kind':'array','element':element,'rank':rank,'sizes':sizes,'lower_bounds':[self.sint() for _ in range(bounds_count)]}
        if tag==0x1b:return {'kind':'function_pointer','signature':self.method(depth+1)}
        raise ValueError(f'Unsupported signature element0x{tag:02x}')
    def method(self,depth=0):
        header=self.byte();base=header&15
        if base not in (0,1,2,3,4,5,8,9,11):raise ValueError(f'Unsupported method calling convention0x{header:02x}')
        generics=self.uint() if header&16 else 0;count=self.uint()
        if count>65535:raise ValueError('Too many parameters')
        result={'calling_convention':base,'has_this':bool(header&32),'explicit_this':bool(header&64),'generic_arity':generics,'return':self.type(depth+1),'parameters':[]}
        for index in range(count):
            if self.at<len(self.data) and self.data[self.at]==0x41:
                self.at+=1;result['sentinel_before_parameter']=index
            result['parameters'].append(self.type(depth+1))
        return result
    def done(self):
        if self.at!=len(self.data):raise ValueError('Trailing signature bytes')


def decode_constant(code,data):
    formats={2:'?',3:'H',4:'b',5:'B',6:'h',7:'H',8:'i',9:'I',10:'q',11:'Q',12:'f',13:'d'}
    if code==14:return data.decode('utf-16-le',errors='surrogatepass')
    if code==18 and data==b'\0\0\0\0':return None
    if code not in formats:raise ValueError('Unsupported constant type')
    if len(data)!=struct.calcsize('<'+formats[code]):raise ValueError('Invalid constant width')
    value=struct.unpack('<'+formats[code],data)[0]
    return {'non_finite':repr(value),'bytes_hex':data.hex()} if isinstance(value,float) and not math.isfinite(value) else value


def inspect(data):
    import dnfile
    pe=dnfile.dnPE(data=data)
    if not pe.net or not pe.net.mdtables:raise ValueError('No managed metadata')
    tables=pe.net.mdtables;active=set()
    def resolve(token):
        tag,rid=token&3,token>>2
        table={0:'TypeDef',1:'TypeRef',2:'TypeSpec'}.get(tag)
        rows=getattr(getattr(tables,table,None),'rows',[]) if table else []
        if rid==0 or rid>len(rows):raise ValueError('Invalid TypeDefOrRefEncoded')
        row=rows[rid-1]
        if table=='TypeSpec':
            if token in active:raise ValueError('Cyclic type specification')
            active.add(token)
            try:
                r=Reader(row.Signature.value,resolve);value=r.type();r.done();return {'table':table,'rid':rid,'signature':value}
            finally:active.remove(token)
        return {'table':table,'rid':rid,'name':(str(row.TypeNamespace)+'.'+str(row.TypeName)).strip('.')}
    constants={};errors=[]
    for index,row in enumerate(getattr(getattr(tables,'Constant',None),'rows',[]),1):
        try:constants[id(row.Parent.row)]={'type_code':row.Type,'value':decode_constant(row.Type,row.Value.value)}
        except (ValueError,UnicodeError,struct.error) as error:errors.append({'table':'Constant','rid':index,'error':str(error)})
    method_ids={id(row):i for i,row in enumerate(getattr(tables.MethodDef,'rows',[]),1)}
    field_ids={id(row):i for i,row in enumerate(getattr(tables.Field,'rows',[]),1)}
    types=[];members=0
    for index,typ in enumerate(tables.TypeDef.rows,1):
        item={'name':(str(typ.TypeNamespace)+'.'+str(typ.TypeName)).strip('.'),'rid':index,'methods':[],'fields':[]}
        for method in typ.MethodList:
            row=method.row;entry={'name':str(row.Name),'rid':method_ids[id(row)],'signature_hex':row.Signature.value.hex()}
            try:
                r=Reader(row.Signature.value,resolve);entry['signature']=r.method();r.done()
                by_sequence={p.row.Sequence:p.row for p in row.ParamList}
                entry['return_name']=str(by_sequence[0].Name) if 0 in by_sequence else None
                for position,param in enumerate(entry['signature']['parameters'],1):
                    metadata=by_sequence.get(position)
                    if metadata:
                        param['parameter_name']=str(metadata.Name)
                        param['in']=bool(metadata.Flags.pdIn);param['out']=bool(metadata.Flags.pdOut);param['optional']=bool(metadata.Flags.pdOptional)
            except (ValueError,IndexError,KeyError) as error:entry['error']=str(error);errors.append({'type':item['name'],'member':entry['name'],'table':'MethodDef','rid':entry['rid'],'error':str(error)})
            item['methods'].append(entry);members+=1
        for field in typ.FieldList:
            row=field.row;entry={'name':str(row.Name),'rid':field_ids[id(row)],'signature_hex':row.Signature.value.hex()}
            try:
                r=Reader(row.Signature.value,resolve)
                if r.byte()!=6:raise ValueError('Invalid field signature prefix')
                entry['type']=r.type();r.done()
                if id(row) in constants:entry['constant']=constants[id(row)]
            except (ValueError,IndexError,KeyError) as error:entry['error']=str(error);errors.append({'type':item['name'],'member':entry['name'],'table':'Field','rid':entry['rid'],'error':str(error)})
            item['fields'].append(entry);members+=1
        types.append(item)
    return {'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'types':types,'members':members,'errors':errors}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('package',type=Path);parser.add_argument('--private-output',type=Path,required=True)
    args=parser.parse_args();files={}
    with zipfile.ZipFile(args.package) as archive:
        for name in archive.namelist():
            if name.lower().endswith('.winmd'):
                try:files[name]=inspect(archive.read(name))
                except Exception as error:files[name]={'error':str(error)}
    errors=sum(len(v.get('errors',[]))+int('error' in v) for v in files.values())
    report={'schema_version':1,'package_sha256':hashlib.sha256(args.package.read_bytes()).hexdigest(),'files':files,'counts':{'files':len(files),'types':sum(len(v.get('types',[])) for v in files.values()),'members':sum(v.get('members',0) for v in files.values()),'errors':errors},'scope':'Metadata signature/constant decoding only, not native method implementation or portable COM/WinRT ABI.'}
    args.private_output.parent.mkdir(parents=True,exist_ok=True);args.private_output.write_text(json.dumps(report,ensure_ascii=True,separators=(',',':')))
    print(json.dumps(report['counts']))
    raise SystemExit(1 if errors else 0)

if __name__=='__main__':main()
