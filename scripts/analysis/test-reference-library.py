"""Synthetic reference DB checks: provenance, crossrefs and read-only literal search."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('library',Path(__file__).with_name('xbox-reference-library.py'))
lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)

class ReferenceTests(unittest.TestCase):
    def signature_fixture(self, root):
        package=root/'signatures.msix'
        raw=b'local metadata fixture'
        with zipfile.ZipFile(package,'w') as archive:archive.writestr('component.winmd',raw)
        data={'package_sha256':lib.sha(package),'files':{'component.winmd':{
            'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'members':1,'errors':[],
            'types':[{'name':'Example','rid':1,'methods':[{'name':'Connect','rid':1,'signature':{'parameters':[]}}],'fields':[]}]}},
            'counts':{'files':1,'types':1,'members':1,'errors':0}}
        return package,root/'signatures.json',data

    def test_typed_signature_import_preserves_owner(self):
        with tempfile.TemporaryDirectory() as directory,sqlite3.connect(':memory:') as db:
            db.executescript(lib.SCHEMA)
            package,path,data=self.signature_fixture(Path(directory));path.write_text(json.dumps(data))
            self.assertEqual(lib.index_signatures(db,package,path),data['counts'])
            self.assertEqual(db.execute('SELECT source,type_name,name FROM native_members').fetchone(),('signatures.json::component.winmd','Example','Connect'))

    def test_typed_signature_hidden_errors_are_rejected(self):
        for level in ('file','member'):
            with self.subTest(level=level),tempfile.TemporaryDirectory() as directory,sqlite3.connect(':memory:') as db:
                db.executescript(lib.SCHEMA)
                package,path,data=self.signature_fixture(Path(directory))
                info=data['files']['component.winmd']
                if level=='file':info['errors']=['failed constant']
                else:info['types'][0]['methods'][0]['error']='failed signature'
                path.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError,'decode error'):lib.index_signatures(db,package,path)

    def test_typed_signature_counts_are_recounted(self):
        for level in ('file','files','types','members'):
            with self.subTest(level=level),tempfile.TemporaryDirectory() as directory,sqlite3.connect(':memory:') as db:
                db.executescript(lib.SCHEMA)
                package,path,data=self.signature_fixture(Path(directory))
                if level=='file':data['files']['component.winmd']['members']=2
                else:data['counts'][level]+=1
                path.write_text(json.dumps(data))
                with self.assertRaisesRegex(ValueError,'count mismatch'):lib.index_signatures(db,package,path)

    def test_xbf_derived_report_mutation_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory,sqlite3.connect(':memory:') as db:
            root=Path(directory);db.executescript(lib.SCHEMA);package=root/'native.msix'
            raw=b'native xbf fixture'
            with zipfile.ZipFile(package,'w') as archive:archive.writestr('TitleBar.xbf',raw)
            digest=hashlib.sha256(raw).hexdigest()
            node={'file_offset':1,'operation':'SetValue','value':32}
            report={'sha256':digest,'complete_stream_decode':True,'errors':[],
                    'streams':[{'index':0,'nodes':[node]}]}
            path=root/'TitleBar.json';path.write_text(json.dumps(report))
            summary={'package_sha256':lib.sha(package),'scope':'native only','resources':[{
                'member':'TitleBar.xbf','report':path.name,'report_sha256':lib.sha(path),
                'sha256':digest,'bytes':len(raw),'errors':[],'complete_stream_decode':True,
                'decoded_nodes':1,'substreams':1}]}
            summary_path=root/'summary.json';summary_path.write_text(json.dumps(summary))
            node['value']=999;path.write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,'decoded report hash mismatch'):lib.index_xbf(db,package,summary_path)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM xbf_nodes').fetchone()[0],0)
            node['value']=32;path.write_text(json.dumps(report))
            self.assertEqual(lib.index_xbf(db,package,summary_path)['decoded_nodes'],1)

    def test_xbf_member_filter_is_literal(self):
        with self.db() as db:
            for member in ('Title_Bar.xbf','TitleXBar.xbf'):
                db.execute('INSERT INTO xbf_nodes VALUES(?,?,?,?,?)',(member,0,1,'SetValue','{"value":32}'))
            result=lib.query(db,argparse.Namespace(command='xbf',member='Title_Bar',term='32',limit=10))
            self.assertEqual([node['member'] for node in result['nodes']],['Title_Bar.xbf'])

    def test_package_preserves_archive_identity_and_member_hash(self):
        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(':memory:') as db:
            package=Path(directory)/'reference.msix'
            with zipfile.ZipFile(package,'w') as z:
                z.writestr('AppxManifest.xml','<Package><Identity Name="Example" Version="1" /></Package>')
                z.writestr('../not-extracted.txt','data')
            db.executescript(lib.SCHEMA)
            report=lib.index_package(db,'test',package)
            self.assertEqual(report['identity']['Name'],'Example')
            self.assertEqual(report['entries'],2)
            self.assertFalse((Path(directory).parent/'not-extracted.txt').exists())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM files').fetchone()[0],2)
            self.assertFalse(report['signature_verified'])

    def test_duplicate_archive_members_rejected(self):
        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(':memory:') as db:
            package=Path(directory)/'test.msix'
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                with zipfile.ZipFile(package,'w') as z:
                    z.writestr('AppxManifest.xml','<Package/>'); z.writestr('same','a');z.writestr('same','b')
            db.executescript(lib.SCHEMA)
            with self.assertRaisesRegex(ValueError,'Duplicate'):lib.index_package(db,'test',package)

    def db(self):
        db=sqlite3.connect(':memory:');db.executescript(lib.SCHEMA)
        meta={'strings':['100%_value','other'], 'functions':[{'id':0,'name':'menu','offset':128,'bytes':2},{'id':1,'name':'other','offset':130,'bytes':1}]}
        code={'errors':[],'functions_indexed':2,'instructions':3,'functions':[{'id':0,'name':'menu','instructions':2,'string_ids':[0],'function_ids':[1]},{'id':1,'name':'other','instructions':1,'string_ids':[1],'function_ids':[]}]}
        lib.index_hermes(db,meta,code)
        return db

    def test_literal_search_and_exact_referrers(self):
        with self.db() as db:
            result=lib.query(db,argparse.Namespace(command='search',term='%_',limit=10))
            self.assertEqual(len(result['strings']),1)
            self.assertEqual(result['strings'][0]['function_ids'],[0])
            result=lib.query(db,argparse.Namespace(command='function',id=1))
            self.assertEqual(result['explicit_referrers'][0]['id'],0)
            self.assertIn('not a complete call graph',result['scope'])

    def test_sql_query_text_cannot_change_database(self):
        with self.db() as db:
            result=lib.query(db,argparse.Namespace(command='search',term="';DROP TABLE functions;--",limit=10))
            self.assertEqual(result['strings'],[])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM functions').fetchone()[0],2)

    def test_native_member_provenance_rejects_stale_input(self):
        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(':memory:') as db:
            package=Path(directory)/'test.msix'
            with zipfile.ZipFile(package,'w') as archive:archive.writestr('component.winmd',b'changed')
            db.executescript(lib.SCHEMA)
            with self.assertRaisesRegex(ValueError,'Native input hash mismatch'):
                lib.index_native(db,'test',{'component.winmd':{'sha256':'0'*64,'bytes':7}},package)

    def test_publication_failure_restores_previous_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);output=root/'out';output.mkdir();staging=root/'stage';staging.mkdir()
            old_db=output/'reference.sqlite3';old_db.write_bytes(b'old database')
            old_summary=output/'summary.json';old_summary.write_bytes(b'old summary')
            new_db=staging/'new.sqlite3';new_db.write_bytes(b'new database')
            new_summary=staging/'new.json';new_summary.write_bytes(b'new summary')
            original=Path.replace
            def fail_summary(source,target):
                if source==new_summary:raise OSError('simulated publication failure')
                return original(source,target)
            with patch.object(Path,'replace',fail_summary):
                with self.assertRaisesRegex(OSError,'publication failure'):
                    lib.publish_generation(new_db,new_summary,output)
            self.assertEqual(old_db.read_bytes(),b'old database')
            self.assertEqual(old_summary.read_bytes(),b'old summary')

    def test_incomplete_bytecode_index_is_rejected(self):
        with sqlite3.connect(':memory:') as db:
            db.executescript(lib.SCHEMA)
            with self.assertRaisesRegex(ValueError,'errors'):
                lib.index_hermes(db,{'strings':[],'functions':[]},{'errors':['failure']})

if __name__=='__main__': unittest.main()
