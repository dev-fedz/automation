from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0036_align_apirunresultreport_testcase_state"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="testcase",
            name="attachment",
        ),
    ]
