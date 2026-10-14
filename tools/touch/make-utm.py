#!/usr/bin/env python3
"""Складывает диск HypeDE Touch в виртуальную машину UTM (.utm).

    tools/touch/make-utm.py [--lite] disk.qcow2 HypeDE-Touch.utm

.utm — это папка с config.plist (настройки UTM 4, движок QEMU) и
Data/<UUID>.qcow2. Обычная машина рассчитана на Mac с Apple M1 и новее:
аппаратная виртуализация, 4 ядра, 4 ГБ памяти, видеокарта virtio-ramfb,
общий буфер обмена и общая папка через VirtFS. --lite — для UTM на iPhone
и iPad (с JIT): процессор эмулируется, поэтому 2 ядра, 1,5 ГБ памяти,
экран без Retina-удвоения и без звука.
"""

import plistlib
import random
import shutil
import sys
import uuid
from pathlib import Path


def mac_address():
    # Локально администрируемый одноадресный MAC, как генерирует сам UTM.
    octets = [random.randint(0, 255) for _ in range(6)]
    octets[0] = (octets[0] & 0xFC) | 0x02
    return ':'.join(f'{o:02X}' for o in octets)


def config(drive_id, vm_id, lite):
    return {
        'Backend': 'QEMU',
        'ConfigurationVersion': 4,
        'Information': {
            'Name': 'HypeDE Touch Lite' if lite else 'HypeDE Touch',
            'UUID': vm_id,
            'Icon': 'linux',
            'IconCustom': False,
            'Notes': 'HypeDE Touch — Arch Linux ARM with HypeDE. User: hypede, password: hypede.',
        },
        'System': {
            'Architecture': 'aarch64',
            'Target': 'virt',
            'CPU': 'default',
            'CPUCount': 2 if lite else 4,
            'CPUFlagsAdd': [],
            'CPUFlagsRemove': [],
            'ForceMulticore': False,
            'JITCacheSize': 0,
            'MemorySize': 1536 if lite else 4096,
        },
        'QEMU': {
            'AdditionalArguments': [],
            'BalloonDevice': False,
            'DebugLog': False,
            'Hypervisor': not lite,
            'PS2Controller': False,
            'RNGDevice': True,
            'RTCLocalTime': False,
            'TPMDevice': False,
            'TSO': False,
            'UEFIBoot': True,
        },
        'Display': [{
            # Как у мастера UTM для Linux: ramfb показывает картинку с первой
            # секунды загрузки. GL-ускорение (virtio-ramfb-gl) включается в
            # настройках машины, но с ним GNOME под UTM бывает чёрным.
            'Hardware': 'virtio-ramfb',
            'DynamicResolution': True,
            'NativeResolution': not lite,
            'DownscalingFilter': 'Linear',
            'UpscalingFilter': 'Linear',
        }],
        'Drive': [{
            'Identifier': drive_id,
            'ImageName': f'{drive_id}.qcow2',
            'ImageType': 'Disk',
            'Interface': 'VirtIO',
            'InterfaceVersion': 1,
            'ReadOnly': False,
        }],
        'Network': [{
            'Hardware': 'virtio-net-pci',
            'Mode': 'Shared',
            'MacAddress': mac_address(),
            'IsolateFromHost': False,
            'PortForward': [],
        }],
        'Sound': [] if lite else [{'Hardware': 'intel-hda'}],
        'Input': {
            'UsbBusSupport': '3.0',
            'UsbSharing': False,
            'MaximumUsbShare': 3,
        },
        'Sharing': {
            'ClipboardSharing': True,
            'DirectoryShareMode': 'VirtFS',
            'DirectoryShareReadOnly': False,
        },
        'Serial': [],
    }


def main():
    args = sys.argv[1:]
    lite = '--lite' in args
    if lite:
        args.remove('--lite')
    if len(args) != 2:
        sys.exit(__doc__.strip().splitlines()[2].strip())
    disk, bundle = Path(args[0]), Path(args[1])
    drive_id = str(uuid.uuid4()).upper()
    vm_id = str(uuid.uuid4()).upper()
    (bundle / 'Data').mkdir(parents=True, exist_ok=False)
    shutil.move(disk, bundle / 'Data' / f'{drive_id}.qcow2')
    with open(bundle / 'config.plist', 'wb') as f:
        plistlib.dump(config(drive_id, vm_id, lite), f)
    print(bundle)


if __name__ == '__main__':
    main()
